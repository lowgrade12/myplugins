const pp_VERSION = "v2.1";

console.log('PornPics Importer ' + pp_VERSION + ' running.');

(function () {
    const PLUGIN_ID = "stash-ppics";
    const TASK_NAME = "Open PornPics";
    const CACHE_BASE = "/plugin/" + PLUGIN_ID + "/assets/cache";
    const SELECTION_STORAGE_PREFIX = "pornpics-importer-selection:";
    const SESSION_RESET_TOKEN_KEY = "pornpics-importer-session-reset-token";
    const GLOBAL_ROUTE_PATH = "/plugin/pornpics";
    const GLOBAL_SAFE_URL =
        "/scenes"
        + String.fromCharCode(63)
        + "ppics=pornpics";

    const GLOBAL_SEARCH_STORAGE_KEY =
        "pornpics-importer-global-search-state";

    const selections = new Map();
    const sceneCache = new Map();
    const pageCache = new Map();
    const importedSceneStatus = new Map();
    const importedImageStatus = new Map();

    let paginationSeed = null;
    let knownTotalCount = null;
    let lastSearchData = null;
    let currentPerformerName = null;
    let currentBrowseContext = null;
    let globalRouteActive = false;
    let globalRouteRegistered = false;
    let lastGlobalSearchState = null;
    let globalSearchTimer = null;
    let globalSearchSequence = 0;
    let sceneImportFilter = "all";
    let lastImportOptions = null;
    let lastImportSelectionPayload = [];
    let lastFailedSelections = [];
    let currentSceneData = null;
    let currentPreflight = null;
    let metadataHydrationToken = 0;
    let activeSpotlight = null;
    let ppicsActive = false;
    let loadingTimer = null;
    let sideMouseHandledAt = 0;
    let metadataObserver = null;
    let metadataQueue = [];
    let metadataQueueActive = 0;
    let importProgressStats = null;
    let importProgressClock = null;
    let globalErrorVisible = false;
    let lastGlobalErrorSignature = "";
    let lastGlobalErrorAt = 0;
    let reviewWizardStep = 0;
    let reviewTagMode = "custom";
    let splashShownThisPage = false;
    let splashLeaveTimer = null;
    let splashRemoveTimer = null;
    let viewAnimationTimer = null;

    const viewHistory = [];
    let viewHistoryIndex = -1;
    let historyRendering = false;

    function escapeHtml(value) {
        if (value === null || typeof value === "undefined") {
            value = "";
        }

        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function makeRequestId() {
        if (
            window.crypto &&
            typeof window.crypto.randomUUID === "function"
        ) {
            return window.crypto.randomUUID().replace(/-/g, "");
        }

        return String(Date.now()) + "_" + Math.random().toString(16).slice(2);
    }

    function imageFilename(url) {
        if (!url) {
            return "";
        }

        try {
            return new URL(url).pathname.split("/").pop() || url;
        } catch (error) {
            return String(url).split("/").pop() || "";
        }
    }

    function imageKey(sceneId, imageUrl) {
        return String(sceneId) + ":" + imageFilename(imageUrl);
    }

    function fullSizeFromThumb(url) {
        if (!url) {
            return null;
        }

        return url.replace("/460/", "/1280/");
    }

    async function runTask(args) {
        const query = `
            mutation RunPPics(
                $plugin_id: ID!,
                $task_name: String!,
                $args_map: Map
            ) {
                runPluginTask(
                    plugin_id: $plugin_id,
                    task_name: $task_name,
                    args_map: $args_map
                )
            }
        `;

        const response = await fetch("/graphql", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "same-origin",
            body: JSON.stringify({
                query: query,
                variables: {
                    plugin_id: PLUGIN_ID,
                    task_name: TASK_NAME,
                    args_map: args
                }
            })
        });

        const result = await response.json();

        if (result.errors && result.errors.length) {
            throw new Error(
                result.errors.map(function (error) {
                    return error.message;
                }).join(", ")
            );
        }

        if (!result.data) {
            throw new Error("Stash returned no task data.");
        }

        return result.data.runPluginTask;
    }

    async function fetchCacheFile(url) {
        try {
            const response = await fetch(url, {
                cache: "no-store",
                credentials: "same-origin"
            });

            if (!response.ok) {
                return null;
            }

            return await response.json();

        } catch (error) {
            return null;
        }
    }

    async function waitForCache(requestId, timeoutMs, onProgress) {
        if (!timeoutMs) {
            timeoutMs = 1800000;
        }

        const started = Date.now();
        let lastProgressSignature = "";

        while (Date.now() - started < timeoutMs) {
            const finalUrl =
                CACHE_BASE +
                "/" +
                encodeURIComponent(requestId) +
                ".json";

            const finalData = await fetchCacheFile(finalUrl);

            if (finalData) {
                handleSessionResetToken(
                    finalData.session_reset_token
                );

                if (finalData.status === "error") {
                    throw new Error(
                        finalData.error ||
                        "PornPics task failed."
                    );
                }

                return finalData;
            }

            if (typeof onProgress === "function") {
                const progressUrl =
                    CACHE_BASE +
                    "/" +
                    encodeURIComponent(requestId) +
                    ".progress.json";

                const progress = await fetchCacheFile(progressUrl);

                if (progress) {
                    const signature = JSON.stringify(progress);

                    if (signature !== lastProgressSignature) {
                        lastProgressSignature = signature;
                        onProgress(progress);
                    }
                }
            }

            await new Promise(function (resolve) {
                setTimeout(resolve, 500);
            });
        }

        throw new Error(
            "Timeout while waiting for PornPics results."
        );
    }

    function saveGlobalSearchState() {
        if (!lastGlobalSearchState) {
            return;
        }

        try {
            window.sessionStorage.setItem(
                GLOBAL_SEARCH_STORAGE_KEY,
                JSON.stringify(
                    lastGlobalSearchState
                )
            );
        } catch (error) {
            console.warn(
                "PornPics search state could not be saved",
                error
            );
        }
    }

    function restoreGlobalSearchState() {
        if (lastGlobalSearchState) {
            return lastGlobalSearchState;
        }

        try {
            const raw =
                window.sessionStorage.getItem(
                    GLOBAL_SEARCH_STORAGE_KEY
                );

            if (!raw) {
                return null;
            }

            const state =
                JSON.parse(
                    raw
                );

            if (
                state
                && typeof state === "object"
            ) {
                lastGlobalSearchState =
                    state;

                return state;
            }
        } catch (error) {
            console.warn(
                "PornPics search state could not be restored",
                error
            );
        }

        return null;
    }

    function clearPornPicsSessionStorage() {
        try {
            const keys = [];

            for (
                let index = 0;
                index < window.sessionStorage.length;
                index += 1
            ) {
                const key =
                    window.sessionStorage.key(
                        index
                    );

                if (
                    key &&
                    key.indexOf(
                        "pornpics-importer-"
                    ) === 0
                ) {
                    keys.push(
                        key
                    );
                }
            }

            keys.forEach(function (key) {
                window.sessionStorage.removeItem(
                    key
                );
            });
        } catch (error) {
            console.warn(
                "PornPics sessionStorage could not be cleared",
                error
            );
        }
    }

    function resetPornPicsSessionState() {
        clearPornPicsSessionStorage();

        selections.clear();
        sceneCache.clear();
        pageCache.clear();
        importedSceneStatus.clear();
        importedImageStatus.clear();

        paginationSeed =
            makeRequestId();

        knownTotalCount = null;
        lastSearchData = null;
        currentSceneData = null;
        currentPreflight = null;
        lastGlobalSearchState = null;
        sceneImportFilter = "all";

        metadataHydrationToken += 1;
        metadataQueue = [];
        metadataQueueActive = 0;

        if (metadataObserver) {
            metadataObserver.disconnect();
            metadataObserver = null;
        }

        viewHistory.length = 0;
        viewHistoryIndex = -1;
        historyRendering = false;

        closeSelectionDrawer();

        if (activeSpotlight) {
            closeSpotlight();
        }

        refreshSelectionCounter();
    }

    function handleSessionResetToken(token) {
        token = String(
            token || ""
        ).trim();

        if (!token) {
            return;
        }

        let previous = "";

        try {
            previous = String(
                window.sessionStorage.getItem(
                    SESSION_RESET_TOKEN_KEY
                ) || ""
            );
        } catch (error) {
            previous = "";
        }

        if (
            !previous ||
            previous !== token
        ) {
            resetPornPicsSessionState();
        }

        try {
            window.sessionStorage.setItem(
                SESSION_RESET_TOKEN_KEY,
                token
            );
        } catch (error) {
            console.warn(
                "PornPics session reset token could not be stored",
                error
            );
        }
    }

    async function requestData(args, onProgress, timeoutMs) {
        const requestId = makeRequestId();
        const taskArgs = Object.assign({}, args, {
            request_id: requestId
        });

        if (!timeoutMs) {
            timeoutMs = 1800000;
        }

        await runTask(taskArgs);

        return waitForCache(
            requestId,
            timeoutMs,
            onProgress
        );
    }

    async function queryJob(jobId) {
        const query = `
            query PPicsFindJob($input: FindJobInput!) {
                findJob(input: $input) {
                    id
                    status
                    description
                    progress
                    error
                }
            }
        `;

        const response = await fetch("/graphql", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "same-origin",
            body: JSON.stringify({
                query: query,
                variables: {
                    input: {
                        id: jobId
                    }
                }
            })
        });

        const result = await response.json();

        if (result.errors && result.errors.length) {
            throw new Error(
                result.errors.map(function (error) {
                    return error.message;
                }).join(", ")
            );
        }

        if (!result.data) {
            return null;
        }

        return result.data.findJob;
    }

    async function waitForJob(jobId, onUpdate) {
        const started = Date.now();
        const timeoutMs = 30 * 60 * 1000;

        while (Date.now() - started < timeoutMs) {
            const job = await queryJob(jobId);

            if (job) {
                if (typeof onUpdate === "function") {
                    onUpdate(job);
                }

                if (job.status === "FINISHED") {
                    return job;
                }

                if (
                    job.status === "FAILED" ||
                    job.status === "CANCELLED"
                ) {
                    throw new Error(
                        job.error ||
                        "Stash scan did not finish successfully."
                    );
                }
            }

            await new Promise(function (resolve) {
                setTimeout(resolve, 1000);
            });
        }

        throw new Error(
            "Timeout while waiting for the Stash scan."
        );
    }

    function isGlobalPornPicsSafeUrl() {
        if (
            window.location.pathname !==
            "/scenes"
        ) {
            return false;
        }

        const params =
            new URLSearchParams(
                window.location.search
            );

        return (
            params.get("ppics") ===
            "pornpics"
        );
    }

    function isRegisteredGlobalPornPicsPath() {
        return (
            window.location.pathname ===
            GLOBAL_ROUTE_PATH
        );
    }

    function isGlobalPornPicsRoute() {
        return (
            isRegisteredGlobalPornPicsPath()
            || isGlobalPornPicsSafeUrl()
        );
    }

    function maskGlobalPornPicsUrl() {
        if (!isRegisteredGlobalPornPicsPath()) {
            return;
        }

        window.history.replaceState(
            window.history.state,
            "",
            GLOBAL_SAFE_URL
        );
    }

    function browseContextKey(context) {
        if (!context) {
            return "";
        }

        return (
            String(context.type || "performer")
            + ":"
            + String(context.value || "")
        ).trim().toLowerCase();
    }

    function currentBrowseIdentity() {
        if (currentBrowseContext) {
            return browseContextKey(
                currentBrowseContext
            );
        }

        return String(
            currentPerformerName || ""
        ).trim().toLowerCase();
    }

    function currentContextType() {
        if (
            currentBrowseContext &&
            currentBrowseContext.type
        ) {
            return currentBrowseContext.type;
        }

        return "performer";
    }

    function currentContextValue() {
        if (
            currentBrowseContext &&
            currentBrowseContext.value
        ) {
            return currentBrowseContext.value;
        }

        return currentPerformerName || "";
    }

    function currentContextPerformer() {
        if (
            currentBrowseContext &&
            currentBrowseContext.type !== "performer"
        ) {
            return "";
        }

        return (
            currentPerformerName
            || currentContextValue()
            || ""
        );
    }

    function currentPerformer() {
        const name = document.querySelector(".performer-name");

        if (!name) {
            return null;
        }

        return name.textContent.trim();
    }

    function performerTabsNav() {
        return document.querySelector(
            "nav.nav.nav-tabs"
        );
    }

    function nativeContentRoot() {
        const panes = document.querySelectorAll(
            '[id^="performer-tabs-tabpane-"]'
        );

        for (
            let index = 0;
            index < panes.length;
            index += 1
        ) {
            const pane = panes[index];
            const parent = pane.parentElement;

            if (
                parent &&
                parent.classList.contains(
                    "tab-content"
                )
            ) {
                return parent;
            }

            const closest =
                pane.closest(
                    ".tab-content"
                );

            if (closest) {
                return closest;
            }
        }

        const tabs =
            performerTabsNav();

        if (!tabs) {
            return null;
        }

        let container =
            tabs.parentElement;

        let depth = 0;

        while (
            container &&
            depth < 5
        ) {
            const children =
                Array.from(
                    container.children || []
                );

            for (
                let index = 0;
                index < children.length;
                index += 1
            ) {
                const child =
                    children[index];

                if (
                    child.classList &&
                    child.classList.contains(
                        "tab-content"
                    )
                ) {
                    return child;
                }
            }

            container =
                container.parentElement;

            depth += 1;
        }

        return null;
    }

    function hideNativePerformerContent(
        nativeContent
    ) {
        if (!nativeContent) {
            return;
        }

        nativeContent.classList.add(
            "ppics-native-content-hidden"
        );

        nativeContent.setAttribute(
            "data-ppics-hidden",
            "true"
        );

        nativeContent.style.setProperty(
            "display",
            "none",
            "important"
        );

        nativeContent.setAttribute(
            "aria-hidden",
            "true"
        );
    }

    function showNativePerformerContent(
        nativeContent
    ) {
        if (!nativeContent) {
            return;
        }

        nativeContent.classList.remove(
            "ppics-native-content-hidden"
        );

        nativeContent.removeAttribute(
            "data-ppics-hidden"
        );

        nativeContent.style.removeProperty(
            "display"
        );

        nativeContent.removeAttribute(
            "aria-hidden"
        );
    }

    function ensurePornPicsMount() {
        let mount =
            document.getElementById(
                "ppics-plugin-root"
            );

        const nativeContent =
            nativeContentRoot();

        if (!nativeContent) {
            return mount;
        }

        if (!mount) {
            mount =
                document.createElement(
                    "div"
                );

            mount.id =
                "ppics-plugin-root";

            mount.className =
                "ppics-plugin-root";

            mount.style.display =
                "none";

            nativeContent.insertAdjacentElement(
                "beforebegin",
                mount
            );
        } else if (
            mount.nextElementSibling !==
            nativeContent
        ) {
            nativeContent.insertAdjacentElement(
                "beforebegin",
                mount
            );
        }

        if (ppicsActive) {
            hideNativePerformerContent(
                nativeContent
            );

            mount.style.display =
                "block";
        }

        return mount;
    }

    function contentRoot() {
        if (isGlobalPornPicsRoute()) {
            return document.getElementById(
                "ppics-global-root"
            );
        }

        return ensurePornPicsMount();
    }

    function activatePornPicsView() {
        ppicsActive = true;

        const nativeContent =
            nativeContentRoot();

        const mount =
            ensurePornPicsMount();

        hideNativePerformerContent(
            nativeContent
        );

        if (mount) {
            mount.style.display =
                "block";
        }
    }

    function deactivatePornPicsView() {
        ppicsActive = false;

        stopLoadingSequence();
        stopMetadataObserver();
        stopImportProgressClock();
        closeSpotlight();
        closeGlobalError();

        const nativeContent =
            nativeContentRoot();

        const mount =
            document.getElementById(
                "ppics-plugin-root"
            );

        showNativePerformerContent(
            nativeContent
        );

        if (mount) {
            mount.style.display =
                "none";
        }
    }

    function stickyTopOffset() {
        const candidates = document.querySelectorAll(
            "header, nav, .navbar, .sticky-top, [class*='sticky']"
        );

        let bottom = 0;

        candidates.forEach(function (element) {
            const style = window.getComputedStyle(element);

            if (
                style.position !== "fixed" &&
                style.position !== "sticky"
            ) {
                return;
            }

            const rect = element.getBoundingClientRect();

            if (rect.height <= 0 || rect.width <= 0) {
                return;
            }

            if (rect.top > 220 || rect.bottom < 0) {
                return;
            }

            if (rect.bottom > bottom) {
                bottom = rect.bottom;
            }
        });

        if (bottom < 126) {
            bottom = 126;
        }

        return bottom;
    }

    function scrollPornPicsToTop() {
        window.requestAnimationFrame(function () {
            const browser = document.querySelector(".ppics-browser");

            if (!browser) {
                return;
            }

            const rect = browser.getBoundingClientRect();
            const offset = stickyTopOffset() + 14;
            const targetTop = window.scrollY + rect.top - offset;

            window.scrollTo({
                top: Math.max(0, targetTop),
                behavior: "auto"
            });
        });
    }

    function removePornPicsSplash() {
        const splash =
            document.getElementById(
                "ppics-startup-splash"
            );

        if (!splash) {
            return;
        }

        splash.classList.add(
            "ppics-splash-leaving"
        );

        if (splashRemoveTimer) {
            window.clearTimeout(
                splashRemoveTimer
            );
        }

        splashRemoveTimer =
            window.setTimeout(
                function () {
                    const current =
                        document.getElementById(
                            "ppics-startup-splash"
                        );

                    if (current) {
                        current.remove();
                    }

                    splashRemoveTimer =
                        null;
                },
                460
            );
    }

    function showPornPicsSplashOnce() {
        if (splashShownThisPage) {
            return;
        }

        splashShownThisPage =
            true;

        const oldSplash =
            document.getElementById(
                "ppics-startup-splash"
            );

        if (oldSplash) {
            oldSplash.remove();
        }

        const splash =
            document.createElement(
                "div"
            );

        splash.id =
            "ppics-startup-splash";

        splash.className =
            "ppics-splash";

        splash.setAttribute(
            "role",
            "status"
        );

        splash.setAttribute(
            "aria-label",
            "PornPics Importer is loading"
        );

        splash.innerHTML = `
            <div class="ppics-splash-atmosphere">
                <span></span>
                <span></span>
                <span></span>
            </div>

            <div class="ppics-splash-content">
                <div class="ppics-splash-mark">
                    <span class="ppics-splash-mark-ring"></span>
                    <span class="ppics-splash-mark-core">P</span>
                </div>

                <div class="ppics-splash-brand">
                    <div class="ppics-splash-title">
                        PornPics
                    </div>

                    <div class="ppics-splash-subtitle">
                        Importer
                    </div>
                </div>

                <div class="ppics-splash-progress">
                    <span></span>
                </div>

                <div class="ppics-splash-version">
                    ${escapeHtml(pp_VERSION)}
                </div>
            </div>
        `;

        document.body.appendChild(
            splash
        );

        window.requestAnimationFrame(
            function () {
                splash.classList.add(
                    "ppics-splash-visible"
                );
            }
        );

        if (splashLeaveTimer) {
            window.clearTimeout(
                splashLeaveTimer
            );
        }

        splashLeaveTimer =
            window.setTimeout(
                function () {
                    splashLeaveTimer =
                        null;

                    removePornPicsSplash();
                },
                1050
            );
    }

    function animatePornPicsView(
        content
    ) {
        if (!content) {
            return;
        }

        const browser =
            content.querySelector(
                ".ppics-browser"
            );

        if (!browser) {
            return;
        }

        browser.classList.remove(
            "ppics-view-enter"
        );

        void browser.offsetWidth;

        browser.classList.add(
            "ppics-view-enter"
        );

        if (viewAnimationTimer) {
            window.clearTimeout(
                viewAnimationTimer
            );
        }

        viewAnimationTimer =
            window.setTimeout(
                function () {
                    browser.classList.remove(
                        "ppics-view-enter"
                    );

                    viewAnimationTimer =
                        null;
                },
                620
            );
    }

    function setContent(html, keepScroll) {
        const content = contentRoot();

        if (content) {
            content.innerHTML = html;

            animatePornPicsView(
                content
            );

            showPornPicsSplashOnce();

            if (!keepScroll) {
                scrollPornPicsToTop();
            }
        }

        return content;
    }

    function stopLoadingSequence() {
        if (loadingTimer) {
            window.clearInterval(loadingTimer);
            loadingTimer = null;
        }
    }

    function renderLoadingShell(title, message, detail) {
        let detailHtml = "";

        if (detail) {
            detailHtml = `
                <div class="ppics-loading-detail text-muted">
                    ${escapeHtml(detail)}
                </div>
            `;
        }

        setContent(`
            <div class="ppics-browser p-3">
                <div class="ppics-loading-shell">
                    <div class="ppics-loading-card">
                        <div class="ppics-loading-orbit">
                            <div
                                class="spinner-border ppics-loading-spinner"
                                role="status"
                                aria-label="Loading"
                            ></div>
                        </div>

                        <div class="ppics-loading-copy">
                            <div class="ppics-eyebrow">
                                PornPics Importer
                            </div>

                            <h2>
                                ${escapeHtml(title)}
                            </h2>

                            <div class="ppics-loading-status">
                                ${escapeHtml(message)}
                            </div>

                            ${detailHtml}
                        </div>
                    </div>
                </div>
            </div>
        `);
    }

    function startLoadingSequence(title, messages, detail) {
        stopLoadingSequence();

        let index = 0;
        const list = Array.from(messages || []);

        if (!list.length) {
            list.push("Working");
        }

        renderLoadingShell(
            title,
            list[0],
            detail
        );

        const startedAt = Date.now();

        loadingTimer = window.setInterval(function () {
            const status = document.querySelector(
                ".ppics-loading-status"
            );

            const detailNode = document.querySelector(
                ".ppics-loading-detail"
            );

            if (index < list.length - 1) {
                index += 1;

                if (status) {
                    status.textContent =
                        list[index];
                }

                return;
            }

            const elapsedSeconds =
                Math.floor(
                    (
                        Date.now() -
                        startedAt
                    ) / 1000
                );

            if (
                elapsedSeconds >= 6 &&
                status
            ) {
                status.textContent =
                    "Still waiting for PornPics";
            }

            if (
                elapsedSeconds >= 6 &&
                detailNode
            ) {
                detailNode.textContent =
                    "The site is responding more slowly than usual · " +
                    String(elapsedSeconds) +
                    "s";
            }
        }, 650);

        return function () {
            stopLoadingSequence();
        };
    }

    function updateLoadingFromProgress(progress) {
        const status = document.querySelector(
            ".ppics-loading-status"
        );
        const detail = document.querySelector(
            ".ppics-loading-detail"
        );

        if (status && progress.message) {
            status.textContent = progress.message;
        }

        if (detail) {
            let text = progress.detail || "";

            if (
                typeof progress.current === "number" &&
                typeof progress.total === "number" &&
                progress.total > 0
            ) {
                if (text) {
                    text += " · ";
                }

                text +=
                    String(progress.current) +
                    " / " +
                    String(progress.total);
            }

            detail.textContent = text;
        }
    }

    function errorText(error) {
        if (!error) {
            return "An unknown error occurred.";
        }

        if (error.message) {
            return String(error.message);
        }

        return String(error);
    }

    function explainError(error, context) {
        const raw = errorText(error);
        const lower = raw.toLowerCase();
        let title = "Something went wrong";
        let explanation = "PornPics Importer could not complete the current action.";
        let suggestion = "Try the action again. If the problem keeps happening, reload Stash and check the plugin log.";

        if (
            lower.indexOf("access is denied") >= 0 ||
            lower.indexOf("permission denied") >= 0 ||
            lower.indexOf("winerror 5") >= 0
        ) {
            title = "Windows blocked file access";
            explanation = "PornPics Importer could not write, replace or read a required file.";
            suggestion = "Check the download folder permissions and make sure antivirus or another program is not locking the file, then retry.";
        } else if (
            lower.indexOf("too deep") >= 0 ||
            lower.indexOf("path") >= 0 &&
            lower.indexOf("download folder") >= 0
        ) {
            title = "The download path is too long";
            explanation = "The configured PornPics output folder leaves too little room for a safe Windows filename.";
            suggestion = "Choose a shorter Download folder in PornPics Importer settings and retry.";
        } else if (
            lower.indexOf("timeout") >= 0 ||
            lower.indexOf("timed out") >= 0
        ) {
            title = "The request took too long";
            explanation = "PornPics or Stash did not finish the request within the expected time.";
            suggestion = "Your connection or PornPics may be slower than usual. Try again in a moment.";
        } else if (
            lower.indexOf("failed to fetch") >= 0 ||
            lower.indexOf("network") >= 0 ||
            lower.indexOf("connection") >= 0
        ) {
            title = "Network connection failed";
            explanation = "The browser could not reach Stash or the PornPics importer task.";
            suggestion = "Check your network connection and confirm that Stash is still running.";
        } else if (
            lower.indexOf("graphql") >= 0 ||
            lower.indexOf("stash returned") >= 0
        ) {
            title = "Stash rejected the request";
            explanation = "Stash returned an API error while PornPics Importer was working.";
            suggestion = "Open the Stash log for more detail, then retry the action.";
        } else if (
            lower.indexOf("pornpics") >= 0 ||
            lower.indexOf("gallery") >= 0
        ) {
            title = "PornPics data could not be loaded";
            explanation = "The source page did not return the data PornPics Importer expected.";
            suggestion = "The site may be temporarily slow or changed. Try the scene or page again.";
        }

        if (context) {
            explanation += " Context: " + String(context) + ".";
        }

        return {
            title: title,
            explanation: explanation,
            suggestion: suggestion,
            technical: raw
        };
    }

    function closeGlobalError() {
        const overlay = document.getElementById(
            "ppics-global-error"
        );

        if (overlay) {
            overlay.remove();
        }

        globalErrorVisible = false;
    }

    function showGlobalError(error, context) {
        if (!ppicsActive) {
            return;
        }

        const info = explainError(
            error,
            context
        );

        const signature =
            info.title +
            "|" +
            info.technical;

        const now = Date.now();

        if (
            signature === lastGlobalErrorSignature &&
            now - lastGlobalErrorAt < 1500
        ) {
            return;
        }

        lastGlobalErrorSignature = signature;
        lastGlobalErrorAt = now;

        closeGlobalError();
        globalErrorVisible = true;

        const overlay = document.createElement(
            "div"
        );

        overlay.id = "ppics-global-error";
        overlay.className = "ppics-global-error";

        overlay.innerHTML = `
            <div class="ppics-global-error-card" role="alertdialog" aria-modal="true">
                <div class="ppics-global-error-icon">!</div>

                <div class="ppics-global-error-content">
                    <div class="ppics-eyebrow">PornPics Importer</div>
                    <h2>${escapeHtml(info.title)}</h2>
                    <p>${escapeHtml(info.explanation)}</p>
                    <p class="text-muted">${escapeHtml(info.suggestion)}</p>

                    <details class="ppics-error-details">
                        <summary>Technical details</summary>
                        <pre>${escapeHtml(info.technical)}</pre>
                    </details>

                    <div class="ppics-global-error-actions">
                        <button
                            type="button"
                            class="btn btn-secondary ppics-global-error-dismiss"
                        >
                            Dismiss
                        </button>

                        <button
                            type="button"
                            class="btn btn-primary ppics-global-error-retry"
                        >
                            Reload PornPics
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(
            overlay
        );

        overlay.querySelector(
            ".ppics-global-error-dismiss"
        ).addEventListener(
            "click",
            closeGlobalError
        );

        overlay.querySelector(
            ".ppics-global-error-retry"
        ).addEventListener(
            "click",
            function () {
                closeGlobalError();

                if (currentPerformerName) {
                    pageCache.clear();
                    loadPerformerPage(1);
                }
            }
        );
    }

    function globalWindowErrorHandler(event) {
        if (!ppicsActive) {
            return;
        }

        if (
            event.target &&
            event.target.tagName &&
            String(event.target.tagName).toLowerCase() === "img"
        ) {
            return;
        }

        const error =
            event.error ||
            new Error(
                event.message ||
                "Unexpected browser error"
            );

        showGlobalError(
            error,
            "UI"
        );
    }

    function globalPromiseErrorHandler(event) {
        if (!ppicsActive) {
            return;
        }

        const reason =
            event.reason ||
            new Error(
                "An asynchronous task failed"
            );

        showGlobalError(
            reason,
            "Background task"
        );
    }

    function renderError(error) {
        stopLoadingSequence();
        stopImportProgressClock();

        const info = explainError(
            error,
            "Current view"
        );

        setContent(`
            <div class="ppics-browser p-3">
                <div class="ppics-state-card ppics-state-error">
                    <div class="ppics-state-icon">
                        !
                    </div>

                    <div>
                        <div class="ppics-eyebrow">
                            PornPics Importer
                        </div>

                        <h2>
                            ${escapeHtml(info.title)}
                        </h2>

                        <div>
                            ${escapeHtml(info.explanation)}
                        </div>

                        <div class="text-muted mt-2">
                            ${escapeHtml(info.suggestion)}
                        </div>

                        <details class="ppics-error-details mt-3">
                            <summary>Technical details</summary>
                            <pre>${escapeHtml(info.technical)}</pre>
                        </details>
                    </div>
                </div>

                <button
                    type="button"
                    id="ppics-error-back"
                    class="btn btn-secondary mt-3"
                >
                    Back
                </button>
            </div>
        `);

        const backButton = document.getElementById(
            "ppics-error-back"
        );

        if (backButton) {
            backButton.addEventListener("click", function () {
                if (!navigateInternal(-1)) {
                    if (currentSceneData) {
                        renderScene(currentSceneData, true);
                        return;
                    }

                    if (lastSearchData) {
                        renderScenes(lastSearchData, true);
                    }
                }
            });
        }
    }

    function viewKey(view) {
        if (!view) {
            return "";
        }

        if (view.type === "scenes") {
            return (
                "scenes:" +
                String(view.data.page || 1)
            );
        }

        if (view.type === "scene") {
            return "scene:" + String(view.scene.url || "");
        }

        if (view.type === "review") {
            return "review:" + String(selectedCount());
        }

        if (view.type === "global_search") {
            return (
                "global_search:"
                + String(view.query || "")
                + ":"
                + String(view.searchType || "all")
            );
        }

        return view.type || "";
    }

    function recordView(view) {
        if (historyRendering) {
            return;
        }

        const key = viewKey(view);
        const current = viewHistory[viewHistoryIndex];

        if (current && viewKey(current) === key) {
            viewHistory[viewHistoryIndex] = view;
            return;
        }

        if (viewHistoryIndex < viewHistory.length - 1) {
            viewHistory.splice(viewHistoryIndex + 1);
        }

        viewHistory.push(view);
        viewHistoryIndex = viewHistory.length - 1;
    }

    function renderHistoryView(view) {
        if (!view) {
            return;
        }

        historyRendering = true;

        if (view.type === "scenes") {
            renderScenes(view.data, false);
        }

        if (view.type === "scene") {
            renderScene(view.scene, false);
        }

        if (view.type === "review") {
            renderReviewReady(
                view.preflight,
                view.groups,
                false
            );
        }

        if (view.type === "global_search") {
            renderGlobalSearchPage(
                view.query,
                view.searchType,
                view.results,
                false
            );
        }

        historyRendering = false;
    }

    function navigateInternal(delta) {
        if (activeSpotlight) {
            moveSpotlight(delta);
            return true;
        }

        const target = viewHistoryIndex + delta;

        if (target < 0 || target >= viewHistory.length) {
            return false;
        }

        viewHistoryIndex = target;
        renderHistoryView(viewHistory[target]);
        return true;
    }

    function handleSideMouseDown(event) {
        if (!ppicsActive) {
            return;
        }

        if (event.button !== 3 && event.button !== 4) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    function handleSideMouseUp(event) {
        if (!ppicsActive) {
            return;
        }

        if (event.button !== 3 && event.button !== 4) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const now = Date.now();

        if (now - sideMouseHandledAt < 180) {
            return;
        }

        sideMouseHandledAt = now;

        if (event.button === 3) {
            navigateInternal(-1);
        }

        if (event.button === 4) {
            navigateInternal(1);
        }
    }

    function handleSideMouseAux(event) {
        if (!ppicsActive) {
            return;
        }

        if (event.button !== 3 && event.button !== 4) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    window.addEventListener(
        "mousedown",
        handleSideMouseDown,
        true
    );
    window.addEventListener(
        "mouseup",
        handleSideMouseUp,
        true
    );
    window.addEventListener(
        "auxclick",
        handleSideMouseAux,
        true
    );

    document.addEventListener(
        "click",
        function (event) {
            const tabs =
                performerTabsNav();

            if (!tabs) {
                return;
            }

            const tab =
                event.target.closest(
                    ".nav-link"
                );

            if (
                !tab ||
                !tabs.contains(tab)
            ) {
                return;
            }

            if (
                tab.id ===
                "performer-tabs-tab-ppics"
            ) {
                return;
            }

            deactivatePornPicsView();

            const ppicsTab =
                document.getElementById(
                    "performer-tabs-tab-ppics"
                );

            if (ppicsTab) {
                ppicsTab.classList.remove(
                    "active"
                );
            }
        },
        true
    );

    function selectionStorageKey(identity) {
        return (
            SELECTION_STORAGE_PREFIX +
            String(identity || "").trim().toLowerCase()
        );
    }

    function saveSelections() {
        const identity = currentBrowseIdentity();

        if (!identity) {
            return;
        }

        const stored = [];

        selections.forEach(function (item) {
            stored.push(item);
        });

        try {
            window.sessionStorage.setItem(
                selectionStorageKey(
                    identity
                ),
                JSON.stringify(stored)
            );
        } catch (error) {
            console.warn(
                "PornPics selection state could not be saved",
                error
            );
        }
    }

    function restoreSelections(performer) {
        selections.clear();

        if (!performer) {
            return;
        }

        try {
            const raw = window.sessionStorage.getItem(
                selectionStorageKey(performer)
            );

            if (!raw) {
                return;
            }

            const stored = JSON.parse(raw);

            if (!Array.isArray(stored)) {
                return;
            }

            stored.forEach(function (item) {
                if (
                    item &&
                    item.key
                ) {
                    selections.set(
                        item.key,
                        item
                    );
                }
            });
        } catch (error) {
            console.warn(
                "PornPics selection state could not be restored",
                error
            );
        }
    }

    function clearStoredSelections() {
        selections.clear();

        const identity = currentBrowseIdentity();

        if (!identity) {
            return;
        }

        try {
            window.sessionStorage.removeItem(
                selectionStorageKey(
                    identity
                )
            );
        } catch (error) {
            console.warn(
                "PornPics selection state could not be cleared",
                error
            );
        }
    }

    function selectedCount() {
        return selections.size;
    }

    function sceneRepresentative(scene) {
        const thumb = scene.thumbnail || "";

        return {
            key: imageKey(scene.id, thumb),
            sceneId: scene.id,
            sceneTitle: scene.title,
            sceneUrl: scene.url,
            imageUrl: fullSizeFromThumb(thumb),
            thumbnail: thumb,
            source: "representative"
        };
    }

    function detailedImageRecord(scene, image) {
        const sourceUrl = image.url || image.thumbnail || "";

        return {
            key: imageKey(scene.id, sourceUrl),
            sceneId: scene.id,
            sceneTitle: scene.title,
            sceneUrl: scene.url,
            imageUrl: image.url,
            thumbnail: image.thumbnail || image.url,
            index: image.index,
            source: "scene"
        };
    }

    function syncSelectionControls() {
        document.querySelectorAll(
            ".ppics-scene-select"
        ).forEach(function (input) {
            const sceneId = input.dataset.sceneId;
            const scene = findScene(lastSearchData, sceneId);

            if (!scene) {
                return;
            }

            const record = sceneRepresentative(scene);
            input.checked = selections.has(record.key);
        });

        document.querySelectorAll(
            ".ppics-image-checkbox"
        ).forEach(function (input) {
            input.checked = selections.has(
                input.dataset.imageKey
            );
        });

        refreshSelectionStyles();
    }

    function refreshSelectionStyles() {
        document.querySelectorAll(
            ".ppics-scene-select"
        ).forEach(function (input) {
            const card = input.closest(".ppics-card");

            if (!card) {
                return;
            }

            if (input.checked) {
                card.classList.add("ppics-is-selected");
            } else {
                card.classList.remove("ppics-is-selected");
            }
        });

        document.querySelectorAll(
            ".ppics-image-checkbox"
        ).forEach(function (input) {
            const card = input.closest(".ppics-image-card");

            if (!card) {
                return;
            }

            if (input.checked) {
                card.classList.add("ppics-is-selected");
            } else {
                card.classList.remove("ppics-is-selected");
            }
        });
    }

    function refreshSelectionCounter() {
        document.querySelectorAll(
            "[data-ppics-selected-count]"
        ).forEach(function (element) {
            element.textContent = String(selectedCount());
        });

        const reviewButton = document.getElementById(
            "ppics-review-button"
        );

        if (reviewButton) {
            reviewButton.disabled = selectedCount() === 0;
        }

        syncSelectionControls();

        if (activeSpotlight) {
            refreshSpotlightSelection();
        }

        refreshSceneSelectionBadges();
        refreshSelectionDrawerIfOpen();
    }

    function toggleSelection(record, checked) {
        if (checked) {
            selections.set(record.key, record);
        } else {
            selections.delete(record.key);
        }

        currentPreflight = null;
        saveSelections();
        refreshSelectionCounter();
    }

    function removeSelectionsForScene(sceneId) {
        const keysToDelete = [];

        selections.forEach(function (item, key) {
            if (String(item.sceneId) === String(sceneId)) {
                keysToDelete.push(key);
            }
        });

        keysToDelete.forEach(function (key) {
            selections.delete(key);
        });

        currentPreflight = null;
        saveSelections();
        refreshAddAllSceneButtons();

    }

    function selectedCountForScene(sceneId) {
        let count = 0;

        selections.forEach(function (item) {
            if (
                String(item.sceneId) ===
                String(sceneId)
            ) {
                count += 1;
            }
        });

        return count;
    }

    function sceneStatusText(status) {
        if (!status || !status.known) {
            return "";
        }

        if (
            status.complete &&
            status.total_count
        ) {
            return "Imported";
        }

        if (
            status.imported_count &&
            status.total_count
        ) {
            return (
                String(status.imported_count) +
                " / " +
                String(status.total_count) +
                " imported"
            );
        }

        if (status.imported_count) {
            return (
                String(status.imported_count) +
                " imported"
            );
        }

        return "";
    }

    function refreshSceneSelectionBadges() {
        document.querySelectorAll(
            "[data-ppics-scene-selection]"
        ).forEach(function (badge) {
            const sceneId =
                badge.dataset.ppicsSceneSelection;

            const count =
                selectedCountForScene(
                    sceneId
                );

            if (count > 0) {
                badge.textContent =
                    String(count) +
                    " selected";

                badge.classList.add(
                    "ppics-status-visible"
                );
            } else {
                badge.textContent = "";

                badge.classList.remove(
                    "ppics-status-visible"
                );
            }
        });
    }

    function sceneImportFilterButton(
        value,
        label
    ) {
        let active = "";

        if (sceneImportFilter === value) {
            active =
                " ppics-scene-filter-active";
        }

        return `
            <button
                type="button"
                class="ppics-scene-filter${active}"
                data-scene-import-filter="${escapeHtml(value)}"
            >
                ${escapeHtml(label)}
            </button>
        `;
    }

    function renderSceneImportFilters() {
        return `
            <div
                class="ppics-scene-filters"
                aria-label="Imported scene filter"
            >
                ${sceneImportFilterButton("all", "All")}
                ${sceneImportFilterButton("not_imported", "Not imported")}
                ${sceneImportFilterButton("imported", "Imported")}
            </div>
        `;
    }

    function applySceneImportFilter() {
        document.querySelectorAll(
            ".ppics-grid .ppics-card"
        ).forEach(function (card) {
            const sceneUrl =
                card.dataset.sceneUrl || "";

            const status =
                importedSceneStatus.get(
                    sceneUrl
                );

            let imported = false;

            if (
                status
                && Number(
                    status.imported_count || 0
                ) > 0
            ) {
                imported = true;
            }

            let visible = true;

            if (
                sceneImportFilter ===
                "imported"
            ) {
                visible = imported;
            }

            if (
                sceneImportFilter ===
                "not_imported"
            ) {
                visible = !imported;
            }

            if (visible) {
                card.classList.remove(
                    "ppics-scene-filter-hidden"
                );
            } else {
                card.classList.add(
                    "ppics-scene-filter-hidden"
                );
            }
        });

        window.requestAnimationFrame(
            refreshMasonryLayout
        );
    }

    function bindSceneImportFilters() {
        document.querySelectorAll(
            ".ppics-scene-filter"
        ).forEach(function (button) {
            button.addEventListener(
                "click",
                function () {
                    sceneImportFilter =
                        button.dataset.sceneImportFilter
                        || "all";

                    document.querySelectorAll(
                        ".ppics-scene-filter"
                    ).forEach(
                        function (item) {
                            item.classList.remove(
                                "ppics-scene-filter-active"
                            );
                        }
                    );

                    button.classList.add(
                        "ppics-scene-filter-active"
                    );

                    applySceneImportFilter();
                }
            );
        });
    }

    function refreshImportStatusUI() {
        document.querySelectorAll(
            "[data-ppics-scene-status]"
        ).forEach(function (badge) {
            const sceneUrl =
                badge.dataset.ppicsSceneStatus;

            const status =
                importedSceneStatus.get(
                    sceneUrl
                );

            const text =
                sceneStatusText(
                    status
                );

            badge.textContent = text;

            if (text) {
                badge.classList.add(
                    "ppics-status-visible"
                );
            } else {
                badge.classList.remove(
                    "ppics-status-visible"
                );
            }
        });

        document.querySelectorAll(
            "[data-ppics-image-status]"
        ).forEach(function (badge) {
            const imageUrl =
                badge.dataset.ppicsImageStatus;

            const status =
                importedImageStatus.get(
                    imageUrl
                );

            if (
                status &&
                status.imported
            ) {
                badge.textContent =
                    "Imported";

                badge.classList.add(
                    "ppics-status-visible"
                );
            } else {
                badge.textContent = "";

                badge.classList.remove(
                    "ppics-status-visible"
                );
            }
        });

        refreshSceneSelectionBadges();
        refreshSelectionDrawerIfOpen();
        applySceneImportFilter();

    }

    function applyImportStatusPayload(payload) {
        const scenes =
            payload.scenes || {};

        Object.keys(
            scenes
        ).forEach(function (sceneUrl) {
            importedSceneStatus.set(
                sceneUrl,
                scenes[sceneUrl]
            );
        });

        const images =
            payload.images || {};

        Object.keys(
            images
        ).forEach(function (imageUrl) {
            importedImageStatus.set(
                imageUrl,
                images[imageUrl]
            );
        });

        refreshImportStatusUI();
    }

    function sceneStatusItems(scenes) {
        const items = [];

        (scenes || []).forEach(function (scene) {
            const cached =
                sceneCache.get(
                    scene.url
                );

            const imageUrls = [];

            if (cached) {
                (cached.images || []).forEach(
                    function (image) {
                        if (image.url) {
                            imageUrls.push(
                                image.url
                            );
                        }
                    }
                );
            }

            items.push({
                scene_url:
                    scene.url,
                title:
                    scene.title,
                image_urls:
                    imageUrls
            });
        });

        return items;
    }

    async function loadImportStatus(items, deep) {
        if (!items || !items.length) {
            return;
        }

        let deepValue = "false";

        if (deep) {
            deepValue = "true";
        }

        try {
            const payload =
                await requestData(
                    {
                        mode:
                            "import_status",
                        status_json:
                            JSON.stringify(
                                items
                            ),
                        deep:
                            deepValue
                    },
                    null,
                    60000
                );

            applyImportStatusPayload(
                payload
            );
        } catch (error) {
            console.warn(
                "PornPics import status could not be loaded",
                error
            );
        }
    }

    function loadPageImportStatus(data) {
        loadImportStatus(
            sceneStatusItems(
                data.scenes || []
            ),
            false
        );
    }

    function loadSceneImportStatus(scene) {
        const imageUrls = [];

        (scene.images || []).forEach(
            function (image) {
                if (image.url) {
                    imageUrls.push(
                        image.url
                    );
                }
            }
        );

        loadImportStatus(
            [
                {
                    scene_url:
                        scene.url,
                    title:
                        scene.title,
                    image_urls:
                        imageUrls
                }
            ],
            true
        );
    }

    function refreshAddAllSceneButtons() {
        document.querySelectorAll(
            ".ppics-add-all-scene"
        ).forEach(function (button) {
            const scene = findScene(
                lastSearchData,
                button.dataset.sceneId
            );

            if (!scene) {
                return;
            }

            const details =
                sceneCache.get(
                    scene.url
                );

            if (
                !details
                || !(details.images || []).length
            ) {
                return;
            }

            let total = 0;
            let selected = 0;

            (details.images || []).forEach(
                function (image) {
                    const record =
                        detailedImageRecord(
                            details,
                            image
                        );

                    total += 1;

                    if (
                        selections.has(
                            record.key
                        )
                    ) {
                        selected += 1;
                    }
                }
            );

            if (
                total > 0
                && selected >= total
            ) {
                button.classList.add(
                    "ppics-add-all-complete"
                );

                button.innerHTML = `
                    <span class="ppics-add-all-icon">✓</span>
                    <span>All photos selected</span>
                `;
            } else {
                button.classList.remove(
                    "ppics-add-all-complete"
                );

                button.innerHTML = `
                    <span class="ppics-add-all-icon">＋</span>
                    <span>Add all photos</span>
                `;
            }
        });
    }

    function renderToolbar(extraHtml) {
        if (!extraHtml) {
            extraHtml = "";
        }

        let disabledAttribute = "";

        if (selectedCount() === 0) {
            disabledAttribute = "disabled";
        }

        return `
            <div class="ppics-toolbar">
                <div class="ppics-selection-count">
                    <span class="ppics-selection-dot"></span>
                    <strong data-ppics-selected-count>
                        ${selectedCount()}
                    </strong>
                    selected
                </div>

                <div class="ppics-toolbar-actions">
                    ${extraHtml}

                    <button
                        type="button"
                        class="btn btn-secondary ppics-selection-drawer-button"
                        ${disabledAttribute}
                    >
                        Selected
                        <span class="ppics-button-count">
                            <span data-ppics-selected-count>
                                ${selectedCount()}
                            </span>
                        </span>
                    </button>

                    <button
                        id="ppics-review-button"
                        class="btn btn-primary"
                        ${disabledAttribute}
                    >
                        Review import
                        <span class="ppics-button-count">
                            <span data-ppics-selected-count>
                                ${selectedCount()}
                            </span>
                        </span>
                    </button>
                </div>
            </div>
        `;
    }

    function findScene(data, sceneId) {
        if (!data) {
            return null;
        }

        let result = null;

        (data.scenes || []).forEach(function (scene) {
            if (String(scene.id) === String(sceneId)) {
                result = scene;
            }
        });

        return result;
    }

    function performerChipHtml(item) {
        const group = item.gender_group || "other";
        let className = "ppics-chip ppics-chip-performer";

        if (group === "woman") {
            className += " ppics-chip-woman";
        }

        if (group === "man") {
            className += " ppics-chip-man";
        }

        if (group === "other") {
            className += " ppics-chip-neutral";
        }

        return `
            <span class="${className}">
                ${escapeHtml(item.name)}
            </span>
        `;
    }

    function performerChips(items, limit) {
        const list = Array.from(items || []);
        let shown = list;

        if (limit && list.length > limit) {
            shown = list.slice(0, limit);
        }

        let html = "";

        shown.forEach(function (item) {
            html += performerChipHtml(item);
        });

        if (limit && list.length > limit) {
            html += `
                <span class="ppics-chip ppics-chip-neutral ppics-chip-more">
                    +${list.length - limit}
                </span>
            `;
        }

        return html;
    }

    function tagChips(values, limit) {
        const list = Array.from(values || []);
        let shown = list;

        if (limit && list.length > limit) {
            shown = list.slice(0, limit);
        }

        let html = "";

        shown.forEach(function (value) {
            html += `
                <span class="ppics-chip ppics-chip-tag">
                    ${escapeHtml(value)}
                </span>
            `;
        });

        if (limit && list.length > limit) {
            html += `
                <span class="ppics-chip ppics-chip-tag ppics-chip-more">
                    +${list.length - limit}
                </span>
            `;
        }

        return html;
    }

    async function getSceneData(scene) {
        if (sceneCache.has(scene.url)) {
            return sceneCache.get(scene.url);
        }

        const data = await requestData(
            {
                mode: "scene",
                scene_url: scene.url
            },
            null,
            60000
        );

        data.scene.id = scene.id;
        data.scene.url = scene.url;

        sceneCache.set(scene.url, data.scene);
        return data.scene;
    }

    function refreshVisibleSceneCount() {
        const counter =
            document.querySelector(
                "[data-ppics-visible-scene-count]"
            );

        if (!counter) {
            return;
        }

        const visibleCards =
            document.querySelectorAll(
                ".ppics-grid .ppics-card"
            ).length;

        counter.textContent =
            String(
                visibleCards
            );
    }

    function hideAgeVerificationSceneCard(
        scene
    ) {
        const card =
            document.querySelector(
                '.ppics-card[data-scene-id="' +
                CSS.escape(
                    String(scene.id)
                ) +
                '"]'
            );

        if (!card) {
            return;
        }

        card.classList.add(
            "ppics-age-verification-hidden"
        );

        window.setTimeout(
            function () {
                if (card.isConnected) {
                    card.remove();
                }

                refreshVisibleSceneCount();
                refreshMasonryLayout();
            },
            190
        );
    }

    function markAgeVerificationSceneCard(
        scene
    ) {
        const card =
            document.querySelector(
                '.ppics-card[data-scene-id="' +
                CSS.escape(
                    String(scene.id)
                ) +
                '"]'
            );

        if (!card) {
            return;
        }

        card.classList.add(
            "ppics-age-verification-card"
        );

        const meta =
            card.querySelector(
                ".ppics-card-meta"
            );

        if (meta) {
            meta.innerHTML = `
                <div class="ppics-age-verification-note">
                    <strong>Age verification required</strong>
                    <span>
                        PornPics is age-gating this gallery for the current server location.
                    </span>
                </div>
            `;
        }

        updateMasonryCard(
            card
        );
    }

    function updateSceneCardMetadata(scene, details) {
        const card = document.querySelector(
            '.ppics-card[data-scene-id="' +
            CSS.escape(String(scene.id)) +
            '"]'
        );

        if (!card) {
            return;
        }

        const meta = card.querySelector(".ppics-card-meta");

        if (!meta) {
            return;
        }

        const performers = details.performer_meta || [];
        const tags = details.tags || [];
        const images = details.images || [];

        meta.innerHTML = `
            <div class="ppics-card-studio">
                ${escapeHtml(details.studio || "Unknown studio")}
            </div>

            <div class="ppics-card-statline">
                <span>${escapeHtml(images.length)} photos</span>
                <span>${escapeHtml(performers.length)} performers</span>
                <span>${escapeHtml(tags.length)} tags</span>
            </div>

            <div class="ppics-card-chips">
                ${performerChips(performers, 2)}
                ${tagChips(tags, 3)}
            </div>
        `;

        updateMasonryCard(card);
    }

    function updateMasonryCard(card) {
        if (!card) {
            return;
        }

        const grid = card.closest(
            ".ppics-grid"
        );

        if (!grid) {
            return;
        }

        const style = window.getComputedStyle(grid);
        const rowHeight = parseFloat(
            style.getPropertyValue(
                "grid-auto-rows"
            )
        );
        const rowGap = parseFloat(
            style.getPropertyValue(
                "row-gap"
            )
        );

        if (!rowHeight) {
            return;
        }

        const height = card.getBoundingClientRect().height;
        const span = Math.ceil(
            (height + rowGap) /
            (rowHeight + rowGap)
        );

        card.style.gridRowEnd =
            "span " + String(span);
    }

    function refreshMasonryLayout() {
        document.querySelectorAll(
            ".ppics-grid .ppics-card"
        ).forEach(function (card) {
            updateMasonryCard(card);
        });
    }

    function bindSceneImagePresentation() {
        document.querySelectorAll(
            ".ppics-scene-thumb"
        ).forEach(function (image) {
            const card = image.closest(
                ".ppics-card"
            );
            const wrap = image.closest(
                ".ppics-image-wrap"
            );

            function finishImage() {
                if (
                    image.naturalWidth > 0 &&
                    image.naturalHeight > 0 &&
                    wrap
                ) {
                    wrap.style.aspectRatio =
                        String(image.naturalWidth) +
                        " / " +
                        String(image.naturalHeight);
                }

                image.classList.add(
                    "ppics-image-loaded"
                );

                const skeleton = wrap && wrap.querySelector(
                    ".ppics-image-skeleton"
                );

                if (skeleton) {
                    skeleton.classList.add(
                        "ppics-skeleton-hidden"
                    );
                }

                window.requestAnimationFrame(function () {
                    updateMasonryCard(card);
                });
            }

            if (
                image.complete &&
                image.naturalWidth > 0
            ) {
                finishImage();
            } else {
                image.addEventListener(
                    "load",
                    finishImage,
                    {once: true}
                );
            }
        });

        window.setTimeout(
            refreshMasonryLayout,
            80
        );
    }

    function stopMetadataObserver() {
        if (metadataObserver) {
            metadataObserver.disconnect();
            metadataObserver = null;
        }

        metadataQueue = [];
        metadataQueueActive = 0;
    }

    function queueSceneMetadata(
        scene,
        token,
        hideAgeVerificationScenes
    ) {
        metadataQueue.push({
            scene: scene,
            token: token,
            hideAgeVerificationScenes:
                Boolean(
                    hideAgeVerificationScenes
                )
        });

        runMetadataQueue();
    }

    function runMetadataQueue() {
        while (
            metadataQueueActive < 3 &&
            metadataQueue.length
        ) {
            const item = metadataQueue.shift();
            metadataQueueActive += 1;

            getSceneData(item.scene)
                .then(function (details) {
                    if (
                        item.token !==
                        metadataHydrationToken
                    ) {
                        return;
                    }

                    if (
                        details.age_verification_required
                    ) {
                        if (
                            item.hideAgeVerificationScenes
                        ) {
                            hideAgeVerificationSceneCard(
                                item.scene
                            );
                        } else {
                            markAgeVerificationSceneCard(
                                item.scene
                            );
                        }

                        return;
                    }

                    updateSceneCardMetadata(
                        item.scene,
                        details
                    );

                    refreshActiveSceneSpotlightMetadata(
                        item.scene,
                        details
                    );

                    loadImportStatus(
                        sceneStatusItems(
                            [item.scene]
                        ),
                        false
                    );
                })
                .catch(function (error) {
                    console.warn(
                        "PPics scene metadata failed:",
                        error
                    );

                    const card = document.querySelector(
                        '.ppics-card[data-scene-id="' +
                        CSS.escape(
                            String(item.scene.id)
                        ) +
                        '"]'
                    );

                    if (card) {
                        const meta = card.querySelector(
                            ".ppics-card-meta"
                        );

                        if (meta) {
                            meta.innerHTML = `
                                <div class="ppics-card-meta-unavailable">
                                    Scene details unavailable
                                </div>
                            `;

                            updateMasonryCard(
                                card
                            );
                        }
                    }
                })
                .finally(function () {
                    metadataQueueActive -= 1;
                    runMetadataQueue();
                });
        }
    }

    function hydrateSceneCards(data) {
        stopMetadataObserver();
        metadataHydrationToken += 1;

        const token =
            metadataHydrationToken;

        const scenes =
            Array.from(
                data.scenes || []
            );

        const byId = new Map();

        scenes.forEach(function (scene) {
            byId.set(
                String(scene.id),
                scene
            );
        });

        if (
            data.hide_age_verification_scenes
        ) {
            scenes.forEach(function (scene) {
                queueSceneMetadata(
                    scene,
                    token,
                    true
                );
            });

            return;
        }

        if (
            typeof window.IntersectionObserver !==
            "function"
        ) {
            scenes.forEach(function (scene) {
                queueSceneMetadata(
                    scene,
                    token,
                    Boolean(
                        data.hide_age_verification_scenes
                    )
                );
            });

            return;
        }

        metadataObserver =
            new IntersectionObserver(
                function (entries) {
                    entries.forEach(
                        function (entry) {
                            if (!entry.isIntersecting) {
                                return;
                            }

                            const card =
                                entry.target;

                            metadataObserver.unobserve(
                                card
                            );

                            const scene =
                                byId.get(
                                    String(
                                        card.dataset.sceneId
                                    )
                                );

                            if (scene) {
                                queueSceneMetadata(
                                    scene,
                                    token
                                );
                            }
                        }
                    );
                },
                {
                    root: null,
                    rootMargin: "700px 0px",
                    threshold: 0.01
                }
            );

        document.querySelectorAll(
            ".ppics-grid .ppics-card"
        ).forEach(function (card) {
            metadataObserver.observe(
                card
            );
        });
    }

    function renderPagination(data) {
        const page = Number(data.page || 1);
        let pageLabel = "Page " + String(page);

        if (data.total_pages) {
            pageLabel += " of " + String(data.total_pages);
        }

        let previousDisabled = "";
        let nextDisabled = "";

        if (!data.has_previous) {
            previousDisabled = "disabled";
        }

        if (!data.has_next) {
            nextDisabled = "disabled";
        }

        return `
            <div class="ppics-pagination">
                <button
                    type="button"
                    class="btn btn-secondary ppics-page-button"
                    data-page-action="previous"
                    ${previousDisabled}
                >
                    ← Previous
                </button>

                <div class="ppics-page-status">
                    <strong>${escapeHtml(pageLabel)}</strong>
                    <span class="text-muted">
                        ${escapeHtml(data.scene_per_page)} scenes per page
                    </span>
                </div>

                <button
                    type="button"
                    class="btn btn-secondary ppics-page-button"
                    data-page-action="next"
                    ${nextDisabled}
                >
                    Next →
                </button>
            </div>
        `;
    }

    function bindPaginationEvents(data) {
        document.querySelectorAll(".ppics-page-button")
            .forEach(function (button) {
                button.addEventListener("click", function () {
                    if (button.disabled) {
                        return;
                    }

                    const action = button.dataset.pageAction;
                    let targetPage = Number(data.page || 1);

                    if (action === "previous") {
                        targetPage -= 1;
                    }

                    if (action === "next") {
                        targetPage += 1;
                    }

                    if (targetPage < 1) {
                        return;
                    }

                    loadPerformerPage(targetPage);
                });
            });
    }

    function browserHeroActions(data) {
        let label = "PornPics";

        if (data.context_type) {
            label =
                data.context_type.charAt(0).toUpperCase()
                + data.context_type.slice(1);
        }

        let html = `
            <div class="ppics-hero-badge">
                ${escapeHtml(label)}
            </div>
        `;

        if (
            currentBrowseContext &&
            currentBrowseContext.source === "global"
        ) {
            html += `
                <button
                    type="button"
                    class="btn btn-secondary btn-sm ppics-back-global-results"
                >
                    ← Search results
                </button>

                <button
                    type="button"
                    class="btn btn-secondary btn-sm ppics-new-global-search"
                >
                    Search again
                </button>
            `;
        }

        return html;
    }

    function renderScenes(data, addHistory) {
        stopLoadingSequence();
        metadataHydrationToken += 1;
        currentSceneData = null;
        currentPreflight = null;
        lastSearchData = data;

        const scenes = data.scenes || [];
        let cards = "";

        scenes.forEach(function (scene) {
            const record = sceneRepresentative(scene);
            const checked = selections.has(record.key);
            let selectedClass = "";
            let checkedAttribute = "";
            let imageHtml = "";

            if (checked) {
                selectedClass = " ppics-is-selected";
                checkedAttribute = "checked";
            }

            if (scene.thumbnail) {
                imageHtml = `
                    <div class="ppics-image-skeleton"></div>

                    <img
                        class="ppics-scene-thumb"
                        src="${escapeHtml(scene.thumbnail)}"
                        alt="${escapeHtml(scene.title)}"
                        loading="lazy"
                    >
                `;
            } else {
                imageHtml = `
                    <div class="ppics-no-image">
                        No preview
                    </div>
                `;
            }

            cards += `
                <article
                    class="ppics-card${selectedClass}"
                    data-scene-id="${escapeHtml(scene.id)}"
                    data-scene-url="${escapeHtml(scene.url)}"
                >
                    <div
                        class="ppics-image-wrap ppics-open-scene-image"
                        data-scene-id="${escapeHtml(scene.id)}"
                        role="button"
                        tabindex="0"
                        title="Open scene"
                    >
                        ${imageHtml}

                        <div class="ppics-card-status-stack">
                            <div
                                class="ppics-status-badge ppics-imported-badge"
                                data-ppics-scene-status="${escapeHtml(scene.url)}"
                            ></div>

                            <div
                                class="ppics-status-badge ppics-selected-badge"
                                data-ppics-scene-selection="${escapeHtml(scene.id)}"
                            ></div>
                        </div>

                        <button
                            type="button"
                            class="ppics-zoom-button ppics-scene-spotlight"
                            data-scene-id="${escapeHtml(scene.id)}"
                            aria-label="Open carousel preview"
                            title="Preview"
                        >
                            &#128269;
                        </button>

                        <label
                            class="ppics-check"
                            title="Select this preview image"
                        >
                            <input
                                type="checkbox"
                                class="ppics-scene-select"
                                data-scene-id="${escapeHtml(scene.id)}"
                                ${checkedAttribute}
                            >
                            <span>Select</span>
                        </label>
                    </div>

                    <div class="ppics-card-body">
                        <div class="ppics-card-title">
                            ${escapeHtml(scene.title)}
                        </div>

                        <div class="ppics-card-meta">
                            <div class="ppics-card-meta-loading">
                                <span class="spinner-border spinner-border-sm"></span>
                                Loading scene details
                            </div>
                        </div>

                        <div class="ppics-card-actions">
                            <button
                                type="button"
                                class="btn btn-secondary btn-sm ppics-view-scene"
                                data-scene-id="${escapeHtml(scene.id)}"
                            >
                                Open scene
                            </button>

                            <button
                                type="button"
                                class="btn btn-secondary btn-sm ppics-add-all-scene"
                                data-scene-id="${escapeHtml(scene.id)}"
                                title="Add every photo from this scene to the selection"
                            >
                                <span class="ppics-add-all-icon">＋</span>
                                <span>Add all photos</span>
                            </button>
                        </div>
                    </div>
                </article>
            `;
        });

        if (!cards) {
            cards = `
                <div class="ppics-empty-state">
                    <div class="ppics-empty-icon">◫</div>
                    <h3>No PornPics scenes found</h3>
                </div>
            `;
        }

        let totalText = "";

        if (data.total_count) {
            totalText =
                " · " +
                escapeHtml(data.total_count) +
                " total";
        }

        setContent(`
            <div class="ppics-browser p-3">
                <div class="ppics-hero">
                    <div>
                        <div class="ppics-eyebrow">
                            PornPics Importer
                        </div>

                        <h2>${escapeHtml(data.performer)}</h2>

                        <div class="ppics-hero-subtitle">
                            <span class="ppics-context-kind">
                                ${escapeHtml(
                                    (
                                        data.context_type === "url"
                                        && "PornPics page"
                                    )
                                    || (
                                        (data.context_type || "PornPics").charAt(0).toUpperCase()
                                        + (data.context_type || "PornPics").slice(1)
                                    )
                                )}
                            </span>

                            <span>
                                <span data-ppics-visible-scene-count>
                                    ${escapeHtml(data.count)}
                                </span>
                                scenes shown${totalText}
                            </span>
                        </div>
                    </div>

                    <div class="ppics-hero-actions">
                        ${browserHeroActions(data)}
                    </div>
                </div>

                ${renderToolbar(renderSceneImportFilters())}
                ${renderPagination(data)}

                <div class="ppics-grid">
                    ${cards}
                </div>

                ${renderPagination(data)}
            </div>
        `);

        bindSceneEvents(data);
        bindPaginationEvents(data);
        bindSceneImportFilters();
        bindReviewButton();
        bindSceneImagePresentation();
        refreshSelectionCounter();
        loadPageImportStatus(data);
        hydrateSceneCards(data);

        const backSearchButton =
            document.querySelector(
                ".ppics-back-global-results"
            );

        if (backSearchButton) {
            backSearchButton.addEventListener(
                "click",
                function () {
                    const state =
                        restoreGlobalSearchState();

                    if (state) {
                        renderGlobalSearchPage(
                            state.query,
                            state.searchType,
                            state.results,
                            true
                        );
                    } else {
                        renderGlobalSearchPage(
                            "",
                            "all",
                            [],
                            true
                        );
                    }
                }
            );
        }

        const newSearchButton = document.querySelector(
            ".ppics-new-global-search"
        );

        if (newSearchButton) {
            newSearchButton.addEventListener(
                "click",
                function () {
                    const state =
                        restoreGlobalSearchState();

                    if (state) {
                        renderGlobalSearchPage(
                            state.query,
                            state.searchType,
                            state.results,
                            true
                        );
                    } else {
                        renderGlobalSearchPage(
                            "",
                            "all",
                            [],
                            true
                        );
                    }

                    window.setTimeout(
                        function () {
                            const searchInput =
                                document.querySelector(
                                    ".ppics-global-search-input"
                                );

                            if (searchInput) {
                                searchInput.focus();
                                searchInput.select();
                            }
                        },
                        30
                    );
                }
            );
        }

        if (addHistory !== false) {
            recordView({
                type: "scenes",
                data: data
            });
        }
    }

    function bindSceneEvents(data) {
        document.querySelectorAll(".ppics-scene-select")
            .forEach(function (input) {
                input.addEventListener("click", function (event) {
                    event.stopPropagation();
                });

                input.addEventListener("change", function () {
                    const scene = findScene(
                        data,
                        input.dataset.sceneId
                    );

                    if (!scene) {
                        return;
                    }

                    toggleSelection(
                        sceneRepresentative(scene),
                        input.checked
                    );
                });
            });

        document.querySelectorAll(".ppics-open-scene-image")
            .forEach(function (element) {
                function activate() {
                    const scene = findScene(
                        data,
                        element.dataset.sceneId
                    );

                    if (scene) {
                        openScene(scene);
                    }
                }

                element.addEventListener("click", function (event) {
                    if (event.target.closest(".ppics-zoom-button")) {
                        return;
                    }

                    if (event.target.closest(".ppics-check")) {
                        return;
                    }

                    activate();
                });

                element.addEventListener("keydown", function (event) {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        activate();
                    }
                });
            });

        document.querySelectorAll(".ppics-view-scene")
            .forEach(function (button) {
                button.addEventListener("click", function () {
                    const scene = findScene(
                        data,
                        button.dataset.sceneId
                    );

                    if (scene) {
                        openScene(scene);
                    }
                });
            });

        document.querySelectorAll(
            ".ppics-add-all-scene"
        ).forEach(function (button) {
            button.addEventListener(
                "click",
                async function () {
                    const scene = findScene(
                        data,
                        button.dataset.sceneId
                    );

                    if (!scene) {
                        return;
                    }

                    const oldHtml = button.innerHTML;
                    button.disabled = true;
                    button.innerHTML = `
                        <span class="spinner-border spinner-border-sm"></span>
                        <span>Adding photos</span>
                    `;

                    try {
                        const details = await getSceneData(
                            scene
                        );

                        (details.images || []).forEach(
                            function (image) {
                                const record = detailedImageRecord(
                                    details,
                                    image
                                );

                                selections.set(
                                    record.key,
                                    record
                                );
                            }
                        );

                        currentPreflight = null;
                        saveSelections();
                        refreshSelectionCounter();

                        button.innerHTML = `
                            <span class="ppics-add-all-icon">✓</span>
                            <span>All photos added</span>
                        `;

                        window.setTimeout(
                            function () {
                                if (button.isConnected) {
                                    button.innerHTML = oldHtml;
                                    button.disabled = false;
                                }
                            },
                            1400
                        );

                    } catch (error) {
                        button.innerHTML = oldHtml;
                        button.disabled = false;
                        showGlobalError(
                            error,
                            "adding all scene photos"
                        );
                    }
                }
            );
        });

        document.querySelectorAll(".ppics-scene-spotlight")
            .forEach(function (button) {
                button.addEventListener("click", function (event) {
                    event.preventDefault();
                    event.stopPropagation();

                    const scene = findScene(
                        data,
                        button.dataset.sceneId
                    );

                    if (scene) {
                        openSceneListSpotlight(data, scene);
                    }
                });
            });
    }

    async function openScene(scene) {
        try {
            if (sceneCache.has(scene.url)) {
                renderScene(
                    sceneCache.get(scene.url),
                    true
                );
                return;
            }

            const stop = startLoadingSequence(
                "Opening scene",
                [
                    "Connecting to PornPics",
                    "Parsing gallery metadata",
                    "Preparing full-size images",
                    "Matching performers in Stash"
                ],
                scene.title
            );

            const data = await requestData(
                {
                    mode: "scene",
                    scene_url: scene.url
                },
                updateLoadingFromProgress
            );

            stop();
            data.scene.id = scene.id;
            data.scene.url = scene.url;
            sceneCache.set(scene.url, data.scene);
            renderScene(data.scene, true);
        } catch (error) {
            console.error(error);
            renderError(error);
        }
    }

    function sceneDetailsHeader(scene) {
        const performers = scene.performer_meta || [];
        const tags = scene.tags || [];
        const images = scene.images || [];
        let sourceButton = "";

        if (scene.url) {
            sourceButton = `
                <a
                    class="btn btn-secondary btn-sm"
                    href="${escapeHtml(scene.url)}"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Open on PornPics
                </a>
            `;
        }

        return `
            <div class="ppics-scene-header">
                <div class="ppics-scene-header-main">
                    <div class="ppics-eyebrow">
                        PornPics scene
                    </div>

                    <h2>${escapeHtml(scene.title)}</h2>

                    <div class="ppics-scene-studio">
                        ${escapeHtml(scene.studio || "Unknown studio")}
                    </div>

                    <div class="ppics-scene-facts">
                        <span>${escapeHtml(images.length)} photos</span>
                        <span>${escapeHtml(performers.length)} performers</span>
                        <span>${escapeHtml(tags.length)} tags</span>
                    </div>

                    <div class="ppics-detail-section">
                        <div class="ppics-detail-label">Performers</div>
                        <div class="ppics-chip-row">
                            ${performerChips(performers)}
                        </div>
                    </div>

                    <div class="ppics-detail-section">
                        <div class="ppics-detail-label">Tags</div>
                        <div class="ppics-chip-row">
                            ${tagChips(tags)}
                        </div>
                    </div>
                </div>

                <div class="ppics-scene-header-actions">
                    ${sourceButton}
                </div>
            </div>
        `;
    }

    function renderAgeVerificationScene(
        scene,
        addHistory
    ) {
        stopLoadingSequence();
        currentSceneData =
            scene;

        let hiddenNote = "";

        if (
            scene.hide_age_verification_scenes
        ) {
            hiddenNote = `
                <div class="alert alert-secondary ppics-soft-alert">
                    This gallery is normally hidden because
                    <strong>Hide age-verification scenes</strong>
                    is enabled in PornPics Importer settings.
                </div>
            `;
        }

        let sourceButton = "";

        if (scene.url) {
            sourceButton = `
                <a
                    class="btn btn-secondary"
                    href="${escapeHtml(scene.url)}"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Open on PornPics
                </a>
            `;
        }

        setContent(`
            <div class="ppics-browser p-3">
                <div class="ppics-state-card ppics-age-verification-view">
                    <div class="ppics-state-icon">
                        18+
                    </div>

                    <div>
                        <div class="ppics-eyebrow">
                            PornPics Importer
                        </div>

                        <h2>
                            Age verification required
                        </h2>

                        <p>
                            PornPics returned an age-verification page instead
                            of the gallery for the location used by this Stash server.
                        </p>

                        ${hiddenNote}

                        <div class="ppics-result-actions">
                            <button
                                type="button"
                                class="btn btn-secondary"
                                id="ppics-age-verification-back"
                            >
                                Back
                            </button>

                            ${sourceButton}
                        </div>
                    </div>
                </div>
            </div>
        `);

        const back =
            document.getElementById(
                "ppics-age-verification-back"
            );

        if (back) {
            back.addEventListener(
                "click",
                function () {
                    navigateInternal(
                        -1
                    );
                }
            );
        }

        if (addHistory !== false) {
            recordView({
                type: "scene",
                scene: scene
            });
        }
    }

    function renderScene(scene, addHistory) {
        if (
            scene
            && scene.age_verification_required
        ) {
            renderAgeVerificationScene(
                scene,
                addHistory
            );

            return;
        }

        stopLoadingSequence();
        metadataHydrationToken += 1;
        currentSceneData = scene;
        currentPreflight = null;

        const sceneImages = scene.images || [];
        let imagesHtml = "";

        sceneImages.forEach(function (image) {
            const record = detailedImageRecord(scene, image);
            const existing = selections.get(record.key);
            let selectedClass = "";
            let checkedAttribute = "";

            if (existing) {
                selections.set(
                    record.key,
                    Object.assign({}, existing, record)
                );

                selectedClass = " ppics-is-selected";
                checkedAttribute = "checked";
            }

            imagesHtml += `
                <div
                    class="ppics-image-card${selectedClass}"
                    data-image-key="${escapeHtml(record.key)}"
                >
                    <div
                        class="ppics-status-badge ppics-image-imported-badge"
                        data-ppics-image-status="${escapeHtml(record.imageUrl)}"
                    ></div>

                    <button
                        type="button"
                        class="ppics-image-open"
                        data-image-key="${escapeHtml(record.key)}"
                        aria-label="Open preview"
                    >
                        <img
                            src="${escapeHtml(record.thumbnail)}"
                            alt="${escapeHtml(scene.title)}"
                            loading="lazy"
                        >
                    </button>

                    <button
                        type="button"
                        class="ppics-zoom-button ppics-image-spotlight"
                        data-image-key="${escapeHtml(record.key)}"
                        aria-label="Open preview"
                        title="Preview"
                    >
                        &#128269;
                    </button>

                    <label class="ppics-image-select">
                        <input
                            type="checkbox"
                            class="ppics-image-checkbox"
                            data-image-key="${escapeHtml(record.key)}"
                            ${checkedAttribute}
                        >

                        <span>#${escapeHtml(image.index)}</span>
                    </label>
                </div>
            `;
        });

        const extraButtons = `
            <button
                type="button"
                id="ppics-back-button"
                class="btn btn-secondary"
            >
                ← Back to scenes
            </button>

            <button
                type="button"
                id="ppics-select-all-button"
                class="btn btn-secondary"
            >
                Select all
            </button>

            <button
                type="button"
                id="ppics-clear-scene-button"
                class="btn btn-secondary"
            >
                Clear scene
            </button>
        `;

        setContent(`
            <div class="ppics-browser p-3">
                ${sceneDetailsHeader(scene)}
                ${renderToolbar(extraButtons)}

                <div class="ppics-image-grid">
                    ${imagesHtml}
                </div>
            </div>
        `);

        const backButton = document.getElementById("ppics-back-button");

        if (backButton) {
            backButton.addEventListener("click", function () {
                if (!navigateInternal(-1) && lastSearchData) {
                    renderScenes(lastSearchData, true);
                }
            });
        }

        const selectAllButton = document.getElementById(
            "ppics-select-all-button"
        );

        if (selectAllButton) {
            selectAllButton.addEventListener("click", function () {
                sceneImages.forEach(function (image) {
                    const record = detailedImageRecord(scene, image);
                    selections.set(record.key, record);
                });

                currentPreflight = null;
                saveSelections();
                refreshSelectionCounter();
            });
        }

        const clearSceneButton = document.getElementById(
            "ppics-clear-scene-button"
        );

        if (clearSceneButton) {
            clearSceneButton.addEventListener("click", function () {
                removeSelectionsForScene(scene.id);
                refreshSelectionCounter();
            });
        }

        document.querySelectorAll(".ppics-image-checkbox")
            .forEach(function (input) {
                input.addEventListener("change", function () {
                    const record = findImageRecordByKey(
                        scene,
                        input.dataset.imageKey
                    );

                    if (record) {
                        toggleSelection(record, input.checked);
                    }
                });
            });

        document.querySelectorAll(".ppics-image-open")
            .forEach(function (button) {
                button.addEventListener("click", function () {
                    openSceneImageSpotlight(
                        scene,
                        button.dataset.imageKey
                    );
                });
            });

        document.querySelectorAll(".ppics-image-spotlight")
            .forEach(function (button) {
                button.addEventListener("click", function () {
                    openSceneImageSpotlight(
                        scene,
                        button.dataset.imageKey
                    );
                });
            });

        bindReviewButton();
        refreshSelectionCounter();

        if (addHistory !== false) {
            recordView({
                type: "scene",
                scene: scene
            });
        }
    }

    function findImageRecordByKey(scene, key) {
        let result = null;

        (scene.images || []).forEach(function (image) {
            const record = detailedImageRecord(scene, image);

            if (record.key === key) {
                result = record;
            }
        });

        return result;
    }

    function spotlightButton(className, label, text) {
        return `
            <button
                type="button"
                class="ppics-spotlight-tool ${className}"
                aria-label="${escapeHtml(label)}"
                title="${escapeHtml(label)}"
            >
                ${text}
            </button>
        `;
    }

    function openSceneListSpotlight(data, initialScene) {
        const items = [];

        (data.scenes || []).forEach(function (scene) {
            const record = sceneRepresentative(scene);

            items.push({
                type: "scene",
                scene: scene,
                imageUrl: record.imageUrl || record.thumbnail,
                thumbnail: record.thumbnail,
                title: scene.title
            });
        });

        let initialIndex = 0;

        items.forEach(function (item, index) {
            if (String(item.scene.id) === String(initialScene.id)) {
                initialIndex = index;
            }
        });

        openSpotlight({
            type: "scene",
            items: items,
            index: initialIndex
        });
    }

    function openSceneImageSpotlight(scene, imageKeyValue) {
        const items = [];

        (scene.images || []).forEach(function (image) {
            const record = detailedImageRecord(scene, image);

            items.push({
                type: "image",
                scene: scene,
                record: record,
                imageUrl: record.imageUrl,
                thumbnail: record.thumbnail,
                title:
                    scene.title +
                    " #" +
                    String(image.index)
            });
        });

        let initialIndex = 0;

        items.forEach(function (item, index) {
            if (item.record.key === imageKeyValue) {
                initialIndex = index;
            }
        });

        openSpotlight({
            type: "image",
            items: items,
            index: initialIndex
        });
    }

    function openSpotlight(config) {
        closeSpotlight();

        activeSpotlight = {
            type: config.type,
            items: config.items,
            index: config.index,
            zoom: 1,
            panX: 0,
            panY: 0,
            panning: false,
            startMouseX: 0,
            startMouseY: 0,
            startPanX: 0,
            startPanY: 0,
            touchStartX: 0,
            touchStartY: 0,
            touchStartedAt: 0
        };

        const overlay = document.createElement("div");
        overlay.id = "ppics-spotlight";
        overlay.className = "ppics-spotlight";

        overlay.innerHTML = `
            <div class="ppics-spotlight-stage">
                <div class="ppics-spotlight-topbar">
                    <div class="ppics-spotlight-counter"></div>

                    <div class="ppics-spotlight-tools">
                        ${spotlightButton(
                            "ppics-spotlight-zoom-out",
                            "Zoom out",
                            "−"
                        )}

                        <div class="ppics-spotlight-zoom-value">
                            100%
                        </div>

                        ${spotlightButton(
                            "ppics-spotlight-zoom-in",
                            "Zoom in",
                            "+"
                        )}

                        ${spotlightButton(
                            "ppics-spotlight-zoom-reset",
                            "Reset zoom",
                            "1:1"
                        )}

                        ${spotlightButton(
                            "ppics-spotlight-fullscreen",
                            "Fullscreen",
                            "⛶"
                        )}

                        ${spotlightButton(
                            "ppics-spotlight-close",
                            "Close",
                            "×"
                        )}
                    </div>
                </div>

                <button
                    type="button"
                    class="ppics-spotlight-arrow ppics-spotlight-prev"
                    aria-label="Previous"
                >
                    ‹
                </button>

                <div class="ppics-spotlight-media-shell">
                    <div class="ppics-spotlight-media">
                        <img
                            class="ppics-spotlight-image"
                            alt=""
                            draggable="false"
                        >
                    </div>
                </div>

                <button
                    type="button"
                    class="ppics-spotlight-arrow ppics-spotlight-next"
                    aria-label="Next"
                >
                    ›
                </button>

                <div class="ppics-spotlight-thumbs"></div>

                <div class="ppics-spotlight-footer">
                    <div class="ppics-spotlight-info">
                        <div class="ppics-spotlight-title"></div>
                        <div class="ppics-spotlight-meta"></div>
                    </div>

                    <div class="ppics-spotlight-actions"></div>
                </div>
            </div>
        `;

        overlay.addEventListener("click", function (event) {
            if (event.target === overlay) {
                closeSpotlight();
            }
        });

        document.body.appendChild(overlay);
        bindSpotlightEvents();
        renderSpotlightItem();

        document.addEventListener(
            "keydown",
            spotlightKeyboardHandler
        );
    }

    function closeSpotlight() {
        document.removeEventListener(
            "keydown",
            spotlightKeyboardHandler
        );

        window.removeEventListener(
            "mousemove",
            spotlightPanMove
        );

        window.removeEventListener(
            "mouseup",
            spotlightPanEnd
        );

        const overlay = document.getElementById("ppics-spotlight");

        if (overlay) {
            if (
                document.fullscreenElement &&
                document.fullscreenElement === overlay
            ) {
                document.exitFullscreen().catch(function () {
                    return null;
                });
            }

            overlay.remove();
        }

        activeSpotlight = null;
        refreshSelectionCounter();
    }

    function spotlightKeyboardHandler(event) {
        if (!activeSpotlight) {
            return;
        }

        if (event.key === "Escape") {
            closeSpotlight();
            return;
        }

        if (event.key === "ArrowLeft") {
            moveSpotlight(-1);
            return;
        }

        if (event.key === "ArrowRight") {
            moveSpotlight(1);
            return;
        }

        if (event.key === "+" || event.key === "=") {
            zoomSpotlightCentered(1.2);
            return;
        }

        if (event.key === "-") {
            zoomSpotlightCentered(0.84);
        }
    }

    function bindSpotlightEvents() {
        const overlay = document.getElementById("ppics-spotlight");

        if (!overlay) {
            return;
        }

        overlay.querySelector(".ppics-spotlight-close")
            .addEventListener("click", closeSpotlight);

        overlay.querySelector(".ppics-spotlight-prev")
            .addEventListener("click", function () {
                moveSpotlight(-1);
            });

        overlay.querySelector(".ppics-spotlight-next")
            .addEventListener("click", function () {
                moveSpotlight(1);
            });

        overlay.querySelector(".ppics-spotlight-zoom-in")
            .addEventListener("click", function () {
                zoomSpotlightCentered(1.2);
            });

        overlay.querySelector(".ppics-spotlight-zoom-out")
            .addEventListener("click", function () {
                zoomSpotlightCentered(0.84);
            });

        overlay.querySelector(".ppics-spotlight-zoom-reset")
            .addEventListener("click", resetSpotlightTransform);

        overlay.querySelector(".ppics-spotlight-fullscreen")
            .addEventListener("click", toggleSpotlightFullscreen);

        const media = overlay.querySelector(".ppics-spotlight-media");

        media.addEventListener("wheel", function (event) {
            event.preventDefault();

            let factor = Math.exp(-event.deltaY * 0.0015);

            if (factor < 0.72) {
                factor = 0.72;
            }

            if (factor > 1.38) {
                factor = 1.38;
            }

            zoomSpotlightAtPoint(
                factor,
                event.clientX,
                event.clientY
            );
        }, {
            passive: false
        });

        media.addEventListener("mousedown", function (event) {
            if (!activeSpotlight || event.button !== 1) {
                return;
            }

            event.preventDefault();

            activeSpotlight.panning = true;
            activeSpotlight.startMouseX = event.clientX;
            activeSpotlight.startMouseY = event.clientY;
            activeSpotlight.startPanX = activeSpotlight.panX;
            activeSpotlight.startPanY = activeSpotlight.panY;
            media.classList.add("ppics-is-panning");
        });

        window.addEventListener("mousemove", spotlightPanMove);
        window.addEventListener("mouseup", spotlightPanEnd);

        media.addEventListener(
            "touchstart",
            function (event) {
                if (
                    !activeSpotlight ||
                    activeSpotlight.zoom > 1.05 ||
                    !event.touches ||
                    event.touches.length !== 1
                ) {
                    return;
                }

                activeSpotlight.touchStartX =
                    event.touches[0].clientX;

                activeSpotlight.touchStartY =
                    event.touches[0].clientY;

                activeSpotlight.touchStartedAt =
                    Date.now();
            },
            {
                passive: true
            }
        );

        media.addEventListener(
            "touchend",
            function (event) {
                if (
                    !activeSpotlight ||
                    activeSpotlight.zoom > 1.05 ||
                    !event.changedTouches ||
                    event.changedTouches.length !== 1
                ) {
                    return;
                }

                const deltaX =
                    event.changedTouches[0].clientX
                    - activeSpotlight.touchStartX;

                const deltaY =
                    event.changedTouches[0].clientY
                    - activeSpotlight.touchStartY;

                const elapsed =
                    Date.now()
                    - activeSpotlight.touchStartedAt;

                if (elapsed > 700) {
                    return;
                }

                if (Math.abs(deltaX) < 55) {
                    return;
                }

                if (Math.abs(deltaX) < Math.abs(deltaY)) {
                    return;
                }

                if (deltaX < 0) {
                    moveSpotlight(1);
                } else {
                    moveSpotlight(-1);
                }
            },
            {
                passive: true
            }
        );

        media.addEventListener("dblclick", function () {
            resetSpotlightTransform();
        });
    }

    function spotlightPanMove(event) {
        if (!activeSpotlight || !activeSpotlight.panning) {
            return;
        }

        activeSpotlight.panX =
            activeSpotlight.startPanX +
            event.clientX -
            activeSpotlight.startMouseX;

        activeSpotlight.panY =
            activeSpotlight.startPanY +
            event.clientY -
            activeSpotlight.startMouseY;

        applySpotlightTransform();
    }

    function spotlightPanEnd() {
        if (!activeSpotlight) {
            return;
        }

        activeSpotlight.panning = false;

        const media = document.querySelector(
            ".ppics-spotlight-media"
        );

        if (media) {
            media.classList.remove("ppics-is-panning");
        }
    }

    function moveSpotlight(delta) {
        if (!activeSpotlight) {
            return;
        }

        const count = activeSpotlight.items.length;

        if (!count) {
            return;
        }

        let nextIndex = activeSpotlight.index + delta;

        if (nextIndex < 0) {
            nextIndex = count - 1;
        }

        if (nextIndex >= count) {
            nextIndex = 0;
        }

        activeSpotlight.index = nextIndex;
        activeSpotlight.zoom = 1;
        activeSpotlight.panX = 0;
        activeSpotlight.panY = 0;
        renderSpotlightItem();
    }

    function clampSpotlightZoom(value) {
        if (value < 0.35) {
            return 0.35;
        }

        if (value > 6) {
            return 6;
        }

        return value;
    }

    function zoomSpotlightCentered(factor) {
        if (!activeSpotlight) {
            return;
        }

        activeSpotlight.zoom = clampSpotlightZoom(
            activeSpotlight.zoom * factor
        );

        applySpotlightTransform();
    }

    function zoomSpotlightAtPoint(factor, clientX, clientY) {
        if (!activeSpotlight) {
            return;
        }

        const media = document.querySelector(".ppics-spotlight-media");

        if (!media) {
            return;
        }

        const rect = media.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const cursorX = clientX - centerX;
        const cursorY = clientY - centerY;
        const oldZoom = activeSpotlight.zoom;
        const newZoom = clampSpotlightZoom(oldZoom * factor);

        if (oldZoom === newZoom) {
            return;
        }

        const ratio = newZoom / oldZoom;

        activeSpotlight.panX =
            cursorX -
            (cursorX - activeSpotlight.panX) * ratio;

        activeSpotlight.panY =
            cursorY -
            (cursorY - activeSpotlight.panY) * ratio;

        activeSpotlight.zoom = newZoom;
        applySpotlightTransform();
    }

    function resetSpotlightTransform() {
        if (!activeSpotlight) {
            return;
        }

        activeSpotlight.zoom = 1;
        activeSpotlight.panX = 0;
        activeSpotlight.panY = 0;
        applySpotlightTransform();
    }

    function applySpotlightTransform() {
        if (!activeSpotlight) {
            return;
        }

        const image = document.querySelector(".ppics-spotlight-image");
        const value = document.querySelector(".ppics-spotlight-zoom-value");

        if (image) {
            image.style.transform =
                "translate(" +
                String(activeSpotlight.panX) +
                "px, " +
                String(activeSpotlight.panY) +
                "px) scale(" +
                String(activeSpotlight.zoom) +
                ")";
        }

        if (value) {
            value.textContent =
                String(
                    Math.round(activeSpotlight.zoom * 100)
                ) +
                "%";
        }
    }

    function toggleSpotlightFullscreen() {
        const overlay = document.getElementById("ppics-spotlight");

        if (!overlay) {
            return;
        }

        if (document.fullscreenElement) {
            document.exitFullscreen().catch(function () {
                return null;
            });
            return;
        }

        if (typeof overlay.requestFullscreen === "function") {
            overlay.requestFullscreen().catch(function () {
                return null;
            });
        }
    }

    function currentSpotlightItem() {
        if (!activeSpotlight) {
            return null;
        }

        return activeSpotlight.items[activeSpotlight.index];
    }

    function preloadSpotlightNeighbors() {
        if (!activeSpotlight) {
            return;
        }

        const count = activeSpotlight.items.length;

        if (count < 2) {
            return;
        }

        const indexes = [
            activeSpotlight.index - 1,
            activeSpotlight.index + 1
        ];

        indexes.forEach(function (index) {
            if (index < 0) {
                index = count - 1;
            }

            if (index >= count) {
                index = 0;
            }

            const item = activeSpotlight.items[index];
            const url = item.imageUrl || item.thumbnail || "";

            if (!url) {
                return;
            }

            const preload = new Image();
            preload.src = url;
        });
    }

    function renderSpotlightThumbnails() {
        const strip = document.querySelector(
            ".ppics-spotlight-thumbs"
        );

        if (!strip || !activeSpotlight) {
            return;
        }

        let html = "";

        activeSpotlight.items.forEach(
            function (item, index) {
                let activeClass = "";

                if (index === activeSpotlight.index) {
                    activeClass = " ppics-spotlight-thumb-active";
                }

                const thumb = item.thumbnail || item.imageUrl || "";

                html += `
                    <button
                        type="button"
                        class="ppics-spotlight-thumb${activeClass}"
                        data-spotlight-index="${escapeHtml(index)}"
                        aria-label="Open item ${escapeHtml(index + 1)}"
                    >
                        <img
                            src="${escapeHtml(thumb)}"
                            alt=""
                            loading="lazy"
                        >
                    </button>
                `;
            }
        );

        strip.innerHTML = html;

        strip.querySelectorAll(
            ".ppics-spotlight-thumb"
        ).forEach(function (button) {
            button.addEventListener(
                "click",
                function () {
                    const index = Number(
                        button.dataset.spotlightIndex
                    );

                    if (!Number.isFinite(index)) {
                        return;
                    }

                    activeSpotlight.index = index;
                    activeSpotlight.zoom = 1;
                    activeSpotlight.panX = 0;
                    activeSpotlight.panY = 0;
                    renderSpotlightItem();
                }
            );
        });

        const active = strip.querySelector(
            ".ppics-spotlight-thumb-active"
        );

        if (active) {
            active.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
                inline: "center"
            });
        }
    }

    function renderSpotlightItem() {
        const overlay = document.getElementById("ppics-spotlight");
        const item = currentSpotlightItem();

        if (!overlay || !item) {
            return;
        }

        const image = overlay.querySelector(".ppics-spotlight-image");
        const counter = overlay.querySelector(".ppics-spotlight-counter");
        const title = overlay.querySelector(".ppics-spotlight-title");
        const meta = overlay.querySelector(".ppics-spotlight-meta");
        const actions = overlay.querySelector(".ppics-spotlight-actions");

        image.src = item.imageUrl || item.thumbnail || "";
        image.alt = item.title || "";

        counter.textContent =
            String(activeSpotlight.index + 1) +
            " / " +
            String(activeSpotlight.items.length);

        title.textContent = item.title || "";
        meta.innerHTML = "";
        actions.innerHTML = "";

        if (activeSpotlight.type === "scene") {
            renderSceneSpotlightMeta(item, meta);

            const openButton = document.createElement("button");
            openButton.type = "button";
            openButton.className = "btn btn-primary";
            openButton.textContent = "Open scene";

            openButton.addEventListener("click", function () {
                const scene = item.scene;
                closeSpotlight();
                openScene(scene);
            });

            actions.appendChild(openButton);
            hydrateSpotlightScene(item);
        }

        if (activeSpotlight.type === "image") {
            const scene = item.scene;
            const performers = scene.performer_meta || [];

            meta.innerHTML = `
                <span class="ppics-spotlight-studio">
                    ${escapeHtml(scene.studio || "Unknown studio")}
                </span>

                <span>${escapeHtml(scene.images.length)} photos</span>

                <span class="ppics-spotlight-mini-chips">
                    ${performerChips(performers, 3)}
                </span>
            `;

            const selectionLabel = document.createElement("label");
            selectionLabel.className = "ppics-spotlight-select";
            selectionLabel.innerHTML = `
                <input
                    type="checkbox"
                    class="ppics-spotlight-select-input"
                >

                <span class="ppics-spotlight-select-text">
                    Select this photo
                </span>
            `;

            selectionLabel.querySelector("input")
                .addEventListener("change", function (event) {
                    toggleSelection(
                        item.record,
                        event.target.checked
                    );
                });

            actions.appendChild(selectionLabel);
            refreshSpotlightSelection();
        }


        if (activeSpotlight.type === "tag_review") {
            meta.innerHTML = `
                <span class="ppics-spotlight-studio">
                    Image tag review
                </span>

                <span>
                    Zoom and inspect the photo before assigning tags
                </span>
            `;
        }

        resetSpotlightTransform();
        renderSpotlightThumbnails();
        preloadSpotlightNeighbors();
    }

    async function hydrateSpotlightScene(item) {
        try {
            const details = await getSceneData(item.scene);

            if (!activeSpotlight || activeSpotlight.type !== "scene") {
                return;
            }

            const current = currentSpotlightItem();

            if (!current || String(current.scene.id) !== String(item.scene.id)) {
                return;
            }

            const meta = document.querySelector(".ppics-spotlight-meta");

            if (meta) {
                renderSceneSpotlightMeta(item, meta, details);
            }
        } catch (error) {
            console.warn(error);
        }
    }

    function renderSceneSpotlightMeta(item, meta, suppliedDetails) {
        const cached = suppliedDetails || sceneCache.get(item.scene.url);

        if (!cached) {
            meta.innerHTML = `
                <span class="text-muted">
                    Loading scene details
                </span>
            `;
            return;
        }

        meta.innerHTML = `
            <span class="ppics-spotlight-studio">
                ${escapeHtml(cached.studio || "Unknown studio")}
            </span>

            <span>${escapeHtml(cached.images.length)} photos</span>

            <span class="ppics-spotlight-mini-chips">
                ${performerChips(cached.performer_meta || [], 3)}
            </span>
        `;
    }

    function refreshActiveSceneSpotlightMetadata(scene, details) {
        if (!activeSpotlight || activeSpotlight.type !== "scene") {
            return;
        }

        const item = currentSpotlightItem();

        if (!item) {
            return;
        }

        if (String(item.scene.id) !== String(scene.id)) {
            return;
        }

        const meta = document.querySelector(".ppics-spotlight-meta");

        if (meta) {
            renderSceneSpotlightMeta(item, meta, details);
        }
    }

    function refreshSpotlightSelection() {
        if (!activeSpotlight || activeSpotlight.type !== "image") {
            return;
        }

        const item = currentSpotlightItem();
        const input = document.querySelector(
            ".ppics-spotlight-select-input"
        );
        const text = document.querySelector(
            ".ppics-spotlight-select-text"
        );

        if (!item || !input || !text) {
            return;
        }

        const checked = selections.has(item.record.key);
        input.checked = checked;

        if (checked) {
            text.textContent = "Selected";
        } else {
            text.textContent = "Select this photo";
        }
    }

    function groupedSelectionDrawerItems() {
        const grouped = new Map();

        selections.forEach(function (item) {
            const sceneId =
                String(
                    item.sceneId || ""
                );

            if (!grouped.has(sceneId)) {
                grouped.set(
                    sceneId,
                    {
                        sceneId:
                            item.sceneId,
                        title:
                            item.sceneTitle ||
                            "PornPics scene",
                        items: []
                    }
                );
            }

            grouped.get(
                sceneId
            ).items.push(
                item
            );
        });

        return Array.from(
            grouped.values()
        );
    }

    function closeSelectionDrawer() {
        const drawer =
            document.getElementById(
                "ppics-selection-drawer"
            );

        if (drawer) {
            drawer.remove();
        }

        document.removeEventListener(
            "keydown",
            selectionDrawerKeyHandler
        );
    }

    function selectionDrawerKeyHandler(event) {
        if (
            event.key ===
            "Escape"
        ) {
            closeSelectionDrawer();
        }
    }

    function selectionDrawerBodyHtml() {
        const groups =
            groupedSelectionDrawerItems();

        if (!groups.length) {
            return `
                <div class="ppics-drawer-empty">
                    <div class="ppics-empty-icon">
                        ✓
                    </div>

                    <h3>
                        Nothing selected
                    </h3>

                    <p>
                        Select photos from the results or scene viewer.
                    </p>
                </div>
            `;
        }

        let html = "";

        groups.forEach(function (group) {
            let itemsHtml = "";

            group.items.forEach(function (item) {
                const thumb =
                    item.thumbnail ||
                    item.imageUrl ||
                    "";

                itemsHtml += `
                    <div class="ppics-drawer-thumb">
                        <img
                            src="${escapeHtml(thumb)}"
                            alt=""
                            loading="lazy"
                        >

                        <button
                            type="button"
                            class="ppics-drawer-remove"
                            data-selection-key="${escapeHtml(item.key)}"
                            aria-label="Remove from selection"
                            title="Remove"
                        >
                            ×
                        </button>
                    </div>
                `;
            });

            html += `
                <section class="ppics-drawer-scene">
                    <div class="ppics-drawer-scene-heading">
                        <div>
                            <strong>
                                ${escapeHtml(group.title)}
                            </strong>

                            <span>
                                ${escapeHtml(group.items.length)}
                                selected
                            </span>
                        </div>

                        <button
                            type="button"
                            class="btn btn-secondary btn-sm ppics-drawer-clear-scene"
                            data-scene-id="${escapeHtml(group.sceneId)}"
                        >
                            Clear scene
                        </button>
                    </div>

                    <div class="ppics-drawer-thumbs">
                        ${itemsHtml}
                    </div>
                </section>
            `;
        });

        return html;
    }

    function bindSelectionDrawerBody() {
        document.querySelectorAll(
            "#ppics-selection-drawer .ppics-drawer-remove"
        ).forEach(function (button) {
            button.addEventListener(
                "click",
                function () {
                    const key =
                        button.dataset.selectionKey;

                    if (key) {
                        selections.delete(
                            key
                        );

                        currentPreflight =
                            null;

                        saveSelections();
                        refreshSelectionCounter();
                    }
                }
            );
        });

        document.querySelectorAll(
            "#ppics-selection-drawer .ppics-drawer-clear-scene"
        ).forEach(function (button) {
            button.addEventListener(
                "click",
                function () {
                    removeSelectionsForScene(
                        button.dataset.sceneId
                    );

                    refreshSelectionCounter();
                }
            );
        });
    }

    function refreshSelectionDrawerIfOpen() {
        const drawer =
            document.getElementById(
                "ppics-selection-drawer"
            );

        if (!drawer) {
            return;
        }

        const count =
            drawer.querySelector(
                "[data-ppics-drawer-count]"
            );

        if (count) {
            count.textContent =
                String(
                    selectedCount()
                );
        }

        const body =
            drawer.querySelector(
                ".ppics-drawer-body"
            );

        if (body) {
            body.innerHTML =
                selectionDrawerBodyHtml();

            bindSelectionDrawerBody();
        }

        const review =
            drawer.querySelector(
                ".ppics-drawer-review"
            );

        if (review) {
            review.disabled =
                selectedCount() === 0;
        }

        const clear =
            drawer.querySelector(
                ".ppics-drawer-clear-all"
            );

        if (clear) {
            clear.disabled =
                selectedCount() === 0;
        }
    }

    function openSelectionDrawer() {
        closeSelectionDrawer();

        const overlay =
            document.createElement(
                "div"
            );

        overlay.id =
            "ppics-selection-drawer";

        overlay.className =
            "ppics-selection-drawer";

        overlay.innerHTML = `
            <div class="ppics-drawer-backdrop"></div>

            <aside class="ppics-drawer-panel">
                <div class="ppics-drawer-header">
                    <div>
                        <div class="ppics-eyebrow">
                            PornPics Importer
                        </div>

                        <h2>
                            Selected photos
                            <span class="ppics-drawer-count">
                                <span data-ppics-drawer-count>
                                    ${selectedCount()}
                                </span>
                            </span>
                        </h2>
                    </div>

                    <button
                        type="button"
                        class="ppics-drawer-close"
                        aria-label="Close"
                        title="Close"
                    >
                        ×
                    </button>
                </div>

                <div class="ppics-drawer-body">
                    ${selectionDrawerBodyHtml()}
                </div>

                <div class="ppics-drawer-footer">
                    <button
                        type="button"
                        class="btn btn-secondary ppics-drawer-clear-all"
                    >
                        Clear all
                    </button>

                    <button
                        type="button"
                        class="btn btn-primary ppics-drawer-review"
                    >
                        Review import
                    </button>
                </div>
            </aside>
        `;

        document.body.appendChild(
            overlay
        );

        overlay.querySelector(
            ".ppics-drawer-backdrop"
        ).addEventListener(
            "click",
            closeSelectionDrawer
        );

        overlay.querySelector(
            ".ppics-drawer-close"
        ).addEventListener(
            "click",
            closeSelectionDrawer
        );

        overlay.querySelector(
            ".ppics-drawer-clear-all"
        ).addEventListener(
            "click",
            function () {
                selections.clear();
                currentPreflight = null;
                saveSelections();
                refreshSelectionCounter();
            }
        );

        overlay.querySelector(
            ".ppics-drawer-review"
        ).addEventListener(
            "click",
            function () {
                if (
                    selectedCount() === 0
                ) {
                    return;
                }

                closeSelectionDrawer();

                if (currentSceneData) {
                    reviewReturnView =
                        "scene";
                } else {
                    reviewReturnView =
                        "scenes";
                }

                startReview();
            }
        );

        bindSelectionDrawerBody();

        document.addEventListener(
            "keydown",
            selectionDrawerKeyHandler
        );
    }

    function bindReviewButton() {
        document.querySelectorAll(
            ".ppics-selection-drawer-button"
        ).forEach(function (button) {
            button.addEventListener(
                "click",
                function () {
                    if (
                        selectedCount() >
                        0
                    ) {
                        openSelectionDrawer();
                    }
                }
            );
        });

        const reviewButton = document.getElementById(
            "ppics-review-button"
        );

        if (!reviewButton) {
            return;
        }

        reviewButton.addEventListener("click", function () {
            startReview();
        });
    }

    function selectionPayload() {
        const result = [];

        selections.forEach(function (item) {
            result.push({
                key: item.key,
                sceneId: item.sceneId,
                sceneTitle: item.sceneTitle,
                sceneUrl: item.sceneUrl,
                imageUrl: item.imageUrl,
                thumbnail: item.thumbnail,
                index: item.index,
                source: item.source
            });
        });

        return result;
    }

    function groupedSelections() {
        const grouped = new Map();

        selections.forEach(function (item) {
            if (!grouped.has(item.sceneId)) {
                grouped.set(item.sceneId, {
                    sceneId: item.sceneId,
                    title: item.sceneTitle,
                    url: item.sceneUrl,
                    images: []
                });
            }

            grouped.get(item.sceneId).images.push(item);
        });

        return Array.from(grouped.values());
    }

    function preflightSceneByUrl(url) {
        if (!currentPreflight) {
            return null;
        }

        let result = null;

        (currentPreflight.scenes || []).forEach(function (scene) {
            if (String(scene.url) === String(url)) {
                result = scene;
            }
        });

        return result;
    }

    function defaultVideoCandidateId(scene) {
        const candidates = scene.video_candidates || [];

        if (!candidates.length) {
            return "";
        }

        const top = candidates[0];

        if (
            typeof top.match_score === "number" &&
            top.match_score >= 0.82
        ) {
            return String(top.id);
        }

        return "";
    }

    function candidateOptionLabel(candidate) {
        let label = candidate.title || "Untitled scene";

        if (candidate.studio && candidate.studio.name) {
            label += " · " + candidate.studio.name;
        }

        if (candidate.date) {
            label += " · " + candidate.date;
        }

        return label;
    }

    function candidateSelectHtml(scene) {
        const candidates = scene.video_candidates || [];
        const defaultId = defaultVideoCandidateId(scene);
        let options = `
            <option value="">Do not link a video scene</option>
        `;

        candidates.forEach(function (candidate) {
            let selected = "";

            if (String(candidate.id) === defaultId) {
                selected = "selected";
            }

            options += `
                <option
                    value="${escapeHtml(candidate.id)}"
                    ${selected}
                >
                    ${escapeHtml(candidateOptionLabel(candidate))}
                </option>
            `;
        });

        return `
            <div class="ppics-review-control-block">
                <div class="ppics-review-control-label">
                    Matching Stash video scene
                </div>

                <div class="ppics-scene-link-row">
                    <select
                        class="form-control ppics-scene-link-select"
                        data-scene-url="${escapeHtml(scene.url)}"
                    >
                        ${options}
                    </select>

                    <div
                        class="ppics-scene-link-preview"
                        data-scene-url="${escapeHtml(scene.url)}"
                    ></div>
                </div>
            </div>
        `;
    }

    function coverChoiceHtml(group, scene) {
        if (group.images.length < 2) {
            return "";
        }

        let html = `
            <div class="ppics-review-control-block">
                <div class="ppics-review-control-label">
                    Gallery cover
                </div>

                <div class="ppics-cover-choices">
        `;

        group.images.forEach(function (image, index) {
            let checked = "";

            if (index === 0) {
                checked = "checked";
            }

            const sourceUrl = image.imageUrl || fullSizeFromThumb(image.thumbnail);

            html += `
                <label class="ppics-cover-choice">
                    <input
                        type="radio"
                        name="ppics-cover-${escapeHtml(group.sceneId)}"
                        class="ppics-cover-radio"
                        data-scene-url="${escapeHtml(group.url)}"
                        data-source-url="${escapeHtml(sourceUrl)}"
                        ${checked}
                    >

                    <img
                        src="${escapeHtml(image.thumbnail || image.imageUrl)}"
                        alt="Cover choice"
                    >

                    <span>Cover</span>
                </label>
            `;
        });

        html += `
                </div>
            </div>
        `;

        return html;
    }

    function sceneTagAssignmentHtml(
        group,
        scene
    ) {
        if (
            !scene
            || currentPreflight
            && currentPreflight.skip_tags
        ) {
            return "";
        }

        const tags = Array.from(
            scene.scene_tags || []
        );

        if (!tags.length) {
            return `
                <div class="ppics-image-tag-review ppics-image-tag-review-empty">
                    <div class="ppics-review-control-label">
                        Image tags
                    </div>
                    <div class="text-muted">
                        PornPics did not provide scene tags for this gallery.
                    </div>
                </div>
            `;
        }

        const images = Array.from(
            scene.selected_images || []
        );

        if (!images.length) {
            return "";
        }

        let galleryNote = `
            PornPics provides these tags for the whole scene. They are not
            added to individual images unless you choose them below.
        `;

        if (group.images.length > 1) {
            galleryNote += `
                The created or reused gallery keeps the available scene tags.
            `;
        } else {
            galleryNote += `
                This is a standalone image import, so only tags you explicitly
                assign here are added to the image.
            `;
        }

        let imageRows = "";

        images.forEach(function (image, imageIndex) {
            const sourceUrl =
                image.source_url || "";

            const thumbnail =
                image.thumbnail
                || sourceUrl;

            let tagChoices = "";

            tags.forEach(function (tagName) {
                tagChoices += `
                    <label
                        class="ppics-image-tag-choice"
                        data-tag-name="${escapeHtml(tagName)}"
                    >
                        <input
                            type="checkbox"
                            class="ppics-image-tag-checkbox"
                            data-scene-url="${escapeHtml(scene.url)}"
                            data-source-url="${escapeHtml(sourceUrl)}"
                            data-tag-name="${escapeHtml(tagName)}"
                        >

                        <span class="ppics-image-tag-choice-body">
                            <span class="ppics-image-tag-choice-name">
                                ${escapeHtml(tagName)}
                            </span>

                            <small class="ppics-image-tag-choice-status">
                                Waiting for metadata decisions
                            </small>
                        </span>
                    </label>
                `;
            });

            imageRows += `
                <div
                    class="ppics-image-tag-image"
                    data-source-url="${escapeHtml(sourceUrl)}"
                >
                    <button
                        type="button"
                        class="ppics-image-tag-thumb ppics-image-tag-preview"
                        data-source-url="${escapeHtml(sourceUrl)}"
                        aria-label="Enlarge image ${escapeHtml(imageIndex + 1)}"
                    >
                        <img
                            src="${escapeHtml(thumbnail)}"
                            alt=""
                        >

                        <span class="ppics-image-tag-index">
                            Image ${escapeHtml(imageIndex + 1)}
                        </span>

                        <span
                            class="ppics-image-tag-zoom"
                            aria-hidden="true"
                        >
                            ⛶
                        </span>
                    </button>

                    <div class="ppics-image-tag-choices">
                        ${tagChoices}
                    </div>
                </div>
            `;
        });

        return `
            <div
                class="ppics-image-tag-review"
                data-scene-url="${escapeHtml(scene.url)}"
            >
                <div class="ppics-image-tag-heading">
                    <div>
                        <div class="ppics-review-control-label">
                            Image tags
                        </div>

                        <p>
                            ${galleryNote}
                            Only tags you matched, found, or chose to create in
                            the Metadata step are available below.
                        </p>
                    </div>
                </div>

                <div class="ppics-image-tag-custom ppics-image-tag-custom-open">
                    <div class="ppics-image-tag-custom-head">
                        <strong>
                            Choose tags for each image
                        </strong>

                        <span>
                            Changes here only affect images from this PornPics scene.
                        </span>
                    </div>

                    <div class="ppics-image-tag-images">
                        ${imageRows}
                    </div>
                </div>
            </div>
        `;
    }

    function metadataTagDecision(
        tagName
    ) {
        let row = null;

        document.querySelectorAll(
            '.ppics-entity-row[data-entity-kind="tag"]'
        ).forEach(function (candidate) {
            if (
                candidate.dataset.entityName ===
                tagName
            ) {
                row = candidate;
            }
        });

        if (!row) {
            return {
                available: false,
                status: "Not imported"
            };
        }

        if (
            row.dataset.entityExists ===
            "true"
        ) {
            return {
                available: true,
                status: "Found in Stash"
            };
        }

        const mappedId =
            row.querySelector(
                ".ppics-entity-mapped-id"
            );

        const mappedName =
            row.querySelector(
                ".ppics-entity-search-input"
            );

        if (
            mappedId
            && mappedId.value
        ) {
            let label =
                "Mapped to existing Stash tag";

            if (
                mappedName
                && mappedName.value
            ) {
                label =
                    "Mapped to "
                    + mappedName.value;
            }

            return {
                available: true,
                status: label
            };
        }

        const createInput =
            row.querySelector(
                ".ppics-create-entity"
            );

        if (
            createInput
            && createInput.checked
        ) {
            return {
                available: true,
                status: "Will be created in Stash"
            };
        }

        return {
            available: false,
            status: "Not imported"
        };
    }

    function refreshImageTagResolution() {
        document.querySelectorAll(
            ".ppics-image-tag-choice"
        ).forEach(function (choice) {
            const tagName =
                choice.dataset.tagName
                || "";

            const decision =
                metadataTagDecision(
                    tagName
                );

            const input =
                choice.querySelector(
                    ".ppics-image-tag-checkbox"
                );

            const status =
                choice.querySelector(
                    ".ppics-image-tag-choice-status"
                );

            if (input) {
                input.disabled =
                    !decision.available;

                if (!decision.available) {
                    input.checked =
                        false;
                }
            }

            choice.classList.toggle(
                "ppics-image-tag-choice-unavailable",
                !decision.available
            );

            if (status) {
                status.textContent =
                    decision.status;
            }
        });

    }

    function openTagReviewSpotlight(
        container,
        sourceUrl
    ) {
        if (!container) {
            return;
        }

        const sceneUrl =
            container.dataset.sceneUrl
            || "";

        const scene =
            preflightSceneByUrl(
                sceneUrl
            );

        let sceneTitle =
            "PornPics scene";

        if (
            scene
            && scene.title
        ) {
            sceneTitle =
                scene.title;
        }

        const items = [];
        let initialIndex = 0;

        container.querySelectorAll(
            ".ppics-image-tag-image"
        ).forEach(function (row, index) {
            const image =
                row.querySelector(
                    ".ppics-image-tag-preview img"
                );

            const rowSource =
                row.dataset.sourceUrl
                || "";

            let thumbnail =
                rowSource;

            if (
                image
                && image.src
            ) {
                thumbnail =
                    image.src;
            }

            items.push({
                type: "tag_review",
                imageUrl: rowSource,
                thumbnail: thumbnail,
                title:
                    sceneTitle
                    + " · Image "
                    + String(index + 1)
            });

            if (
                rowSource === sourceUrl
            ) {
                initialIndex =
                    index;
            }
        });

        if (!items.length) {
            return;
        }

        openSpotlight({
            type: "tag_review",
            items: items,
            index: initialIndex
        });
    }

    function tagModeLabel(
        mode
    ) {
        if (mode === "none") {
            return "No PornPics tags";
        }

        if (mode === "all") {
            return "All scene tags";
        }

        return "Select per image";
    }

    function tagHandlingStepHtml() {
        return `
            <div class="ppics-tag-mode-grid">
                <button
                    type="button"
                    class="ppics-tag-mode-card"
                    data-tag-mode="none"
                >
                    <span class="ppics-tag-mode-icon">○</span>

                    <strong>
                        No PornPics tags
                    </strong>

                    <span>
                        Skip PornPics scene tags for this import.
                        Performer and studio metadata can still be imported.
                    </span>

                    <small>
                        The internal PornPics Importer marker is kept.
                    </small>
                </button>

                <button
                    type="button"
                    class="ppics-tag-mode-card"
                    data-tag-mode="all"
                >
                    <span class="ppics-tag-mode-icon">✓</span>

                    <strong>
                        All scene tags
                    </strong>

                    <span>
                        Match the PornPics tags in Stash and apply every
                        resolved scene tag to the selected images from that scene.
                    </span>

                    <small>
                        Each PornPics scene keeps its own tag set.
                    </small>
                </button>

                <button
                    type="button"
                    class="ppics-tag-mode-card"
                    data-tag-mode="custom"
                >
                    <span class="ppics-tag-mode-icon">✦</span>

                    <strong>
                        Select per image
                    </strong>

                    <span>
                        Match tags first, then visually decide which tags
                        belong to each selected image.
                    </span>

                    <small>
                        Recommended when scene tags do not apply to every photo.
                    </small>
                </button>
            </div>
        `;
    }

    function updateTagModeCards() {
        document.querySelectorAll(
            ".ppics-tag-mode-card"
        ).forEach(function (button) {
            button.classList.toggle(
                "ppics-tag-mode-card-active",
                button.dataset.tagMode ===
                reviewTagMode
            );
        });
    }

    function updateMetadataTagVisibility() {
        const section =
            document.querySelector(
                "[data-ppics-metadata-tags]"
            );

        if (!section) {
            return;
        }

        section.classList.toggle(
            "ppics-metadata-section-hidden",
            reviewTagMode === "none"
        );
    }

    function reviewStepIds() {
        return reviewStepDefinitions(
            currentPreflight || {}
        ).map(
            function (step) {
                return step.id;
            }
        );
    }

    function refreshReviewWizardStructure() {
        updateTagModeCards();
        updateMetadataTagVisibility();

        const steps =
            reviewStepDefinitions(
                currentPreflight || {}
            );

        const stepper =
            document.querySelector(
                ".ppics-review-stepper"
            );

        if (stepper) {
            stepper.outerHTML =
                reviewStepperHtml(
                    steps
                );
        }

        const allowed =
            reviewStepIds();

        document.querySelectorAll(
            ".ppics-review-step"
        ).forEach(function (section) {
            const stepId =
                section.dataset.reviewStepId
                || "";

            section.classList.toggle(
                "ppics-review-step-disabled",
                allowed.indexOf(
                    stepId
                ) < 0
            );
        });

        const visible =
            reviewStepElements();

        if (!visible.length) {
            return;
        }

        if (
            reviewWizardStep >=
            visible.length
        ) {
            reviewWizardStep =
                visible.length - 1;
        }

        showReviewStep(
            reviewWizardStep
        );
    }

    function setReviewTagMode(
        mode
    ) {
        if (
            mode !== "none"
            && mode !== "all"
            && mode !== "custom"
        ) {
            mode =
                "custom";
        }

        reviewTagMode =
            mode;

        refreshReviewWizardStructure();
    }

    function bindTagModeControls() {
        document.querySelectorAll(
            ".ppics-tag-mode-card"
        ).forEach(function (button) {
            button.addEventListener(
                "click",
                function () {
                    setReviewTagMode(
                        button.dataset.tagMode
                        || "custom"
                    );
                }
            );
        });

        updateTagModeCards();
    }

    function bindImageTagControls() {
        document.querySelectorAll(
            ".ppics-image-tag-review"
        ).forEach(function (container) {
            container.querySelectorAll(
                ".ppics-image-tag-checkbox"
            ).forEach(function (input) {
                input.addEventListener(
                    "change",
                    function () {
                        return;
                    }
                );
            });

            container.querySelectorAll(
                ".ppics-image-tag-preview"
            ).forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        openTagReviewSpotlight(
                            container,
                            button.dataset.sourceUrl
                            || ""
                        );
                    }
                );
            });
        });
    }

    function reviewSceneHtml(groups) {
        let html = "";

        groups.forEach(function (group) {
            let action = "Standalone image";

            if (group.images.length > 1) {
                action = "Create gallery";
            }

            let thumbnails = "";

            group.images.forEach(function (image) {
                const thumb = image.thumbnail || image.imageUrl || "";

                thumbnails += `
                    <img src="${escapeHtml(thumb)}" alt="">
                `;
            });

            const scene = preflightSceneByUrl(group.url) || {
                url: group.url,
                video_candidates: []
            };

            html += `
                <div class="ppics-review-scene">
                    <div class="ppics-review-scene-heading">
                        <div>
                            <strong>${escapeHtml(group.title)}</strong>
                            <div class="text-muted">
                                ${escapeHtml(group.images.length)} selected
                            </div>
                        </div>

                        <span class="ppics-review-action">
                            ${escapeHtml(action)}
                        </span>
                    </div>

                    <div class="ppics-review-thumbs">
                        ${thumbnails}
                    </div>

                    ${sceneTagAssignmentHtml(group, scene)}
                    ${coverChoiceHtml(group, scene)}
                    ${candidateSelectHtml(scene)}
                </div>
            `;
        });

        return html;
    }

    function reviewImageTagScenesHtml(
        groups
    ) {
        let html = "";

        groups.forEach(function (group) {
            const scene =
                preflightSceneByUrl(
                    group.url
                )
                || {
                    url: group.url,
                    scene_tags: [],
                    selected_images: []
                };

            let thumbnails = "";

            group.images.forEach(function (image) {
                const thumb =
                    image.thumbnail
                    || image.imageUrl
                    || "";

                thumbnails += `
                    <img
                        src="${escapeHtml(thumb)}"
                        alt=""
                    >
                `;
            });

            html += `
                <div class="ppics-review-scene">
                    <div class="ppics-review-scene-heading">
                        <div>
                            <strong>
                                ${escapeHtml(group.title)}
                            </strong>

                            <div class="text-muted">
                                ${escapeHtml(group.images.length)} selected
                            </div>
                        </div>

                        <span class="ppics-review-action">
                            Image tags
                        </span>
                    </div>

                    <div class="ppics-review-thumbs">
                        ${thumbnails}
                    </div>

                    ${sceneTagAssignmentHtml(group, scene)}
                </div>
            `;
        });

        return html;
    }

    function reviewSceneOptionsHtml(
        groups
    ) {
        let html = "";

        groups.forEach(function (group) {
            const scene =
                preflightSceneByUrl(
                    group.url
                )
                || {
                    url: group.url,
                    video_candidates: []
                };

            let action =
                "Standalone image";

            if (
                group.images.length > 1
            ) {
                action =
                    "Gallery";
            }

            let thumbnails = "";

            group.images.forEach(function (image) {
                const thumb =
                    image.thumbnail
                    || image.imageUrl
                    || "";

                thumbnails += `
                    <img
                        src="${escapeHtml(thumb)}"
                        alt=""
                    >
                `;
            });

            html += `
                <div class="ppics-review-scene">
                    <div class="ppics-review-scene-heading">
                        <div>
                            <strong>
                                ${escapeHtml(group.title)}
                            </strong>

                            <div class="text-muted">
                                ${escapeHtml(group.images.length)} selected
                            </div>
                        </div>

                        <span class="ppics-review-action">
                            ${escapeHtml(action)}
                        </span>
                    </div>

                    <div class="ppics-review-thumbs">
                        ${thumbnails}
                    </div>

                    ${coverChoiceHtml(group, scene)}
                    ${candidateSelectHtml(scene)}
                </div>
            `;
        });

        return html;
    }

    function reviewFinalScenesHtml(
        groups
    ) {
        let html = "";

        groups.forEach(function (group) {
            let action =
                "Standalone image";

            if (
                group.images.length > 1
            ) {
                action =
                    "Gallery";
            }

            html += `
                <div class="ppics-review-final-scene">
                    <div>
                        <strong>
                            ${escapeHtml(group.title)}
                        </strong>

                        <span>
                            ${escapeHtml(group.images.length)}
                            selected photos
                        </span>
                    </div>

                    <span>
                        ${escapeHtml(action)}
                    </span>
                </div>
            `;
        });

        return html;
    }

    function reviewStepDefinitions(
        preflight
    ) {
        const result = [];

        if (!preflight.skip_tags) {
            result.push({
                id: "tag-handling",
                label: "Tag handling"
            });
        }

        if (
            !preflight.skip_performers
            || !preflight.skip_studio
            || (
                !preflight.skip_tags
                && reviewTagMode !== "none"
            )
        ) {
            result.push({
                id: "metadata",
                label: "Metadata"
            });
        }

        if (
            !preflight.skip_tags
            && reviewTagMode === "custom"
        ) {
            result.push({
                id: "image-tags",
                label: "Image tags"
            });
        }

        result.push({
            id: "scene-options",
            label: "Scene options"
        });

        result.push({
            id: "final",
            label: "Review"
        });

        return result;
    }

    function reviewStepperHtml(
        steps
    ) {
        let html = "";

        steps.forEach(function (step, index) {
            html += `
                <div
                    class="ppics-review-stepper-item"
                    data-review-step-index="${escapeHtml(index)}"
                    data-review-step-id="${escapeHtml(step.id)}"
                >
                    <span>
                        ${escapeHtml(index + 1)}
                    </span>

                    <strong>
                        ${escapeHtml(step.label)}
                    </strong>
                </div>
            `;
        });

        return `
            <div class="ppics-review-stepper">
                ${html}
            </div>
        `;
    }

    function reviewStepSection(
        id,
        title,
        copy,
        body
    ) {
        return `
            <section
                class="ppics-review-step"
                data-review-step-id="${escapeHtml(id)}"
            >
                <div class="ppics-section-heading ppics-review-step-heading">
                    <div>
                        <h3>
                            ${escapeHtml(title)}
                        </h3>

                        <p>
                            ${escapeHtml(copy)}
                        </p>
                    </div>
                </div>

                ${body}
            </section>
        `;
    }

    function countObjectEntries(
        value
    ) {
        if (
            !value
            || typeof value !== "object"
        ) {
            return 0;
        }

        return Object.keys(
            value
        ).length;
    }

    function imageTagAssignmentStats(
        assignments
    ) {
        let photos = 0;
        let tags = 0;

        Object.keys(
            assignments || {}
        ).forEach(function (sceneUrl) {
            const imageMap =
                assignments[
                    sceneUrl
                ]
                || {};

            Object.keys(
                imageMap
            ).forEach(function (sourceUrl) {
                const names =
                    imageMap[
                        sourceUrl
                    ]
                    || [];

                if (names.length) {
                    photos += 1;
                    tags += names.length;
                }
            });
        });

        return {
            photos: photos,
            tags: tags
        };
    }

    function refreshFinalReviewSummary() {
        const target =
            document.getElementById(
                "ppics-final-review-decisions"
            );

        if (!target) {
            return;
        }

        const options =
            collectImportOptions();

        const tagStats =
            imageTagAssignmentStats(
                options.image_tag_assignments
            );

        const createCount =
            options.create_performers.length
            + options.create_studios.length
            + options.create_tags.length;

        const mapCount =
            countObjectEntries(
                options.performer_aliases
            )
            + countObjectEntries(
                options.studio_aliases
            )
            + countObjectEntries(
                options.tag_aliases
            );

        const linkCount =
            countObjectEntries(
                options.scene_links
            );

        let organizedLabel =
            "No";

        if (options.organized) {
            organizedLabel =
                "Yes";
        }

        target.innerHTML = `
            <div>
                <strong>${escapeHtml(tagModeLabel(reviewTagMode))}</strong>
                <span>tag handling</span>
            </div>

            <div>
                <strong>${escapeHtml(createCount)}</strong>
                <span>new metadata entries</span>
            </div>

            <div>
                <strong>${escapeHtml(mapCount)}</strong>
                <span>metadata mappings</span>
            </div>

            <div>
                <strong>${escapeHtml(tagStats.tags)}</strong>
                <span>image tag assignments</span>
            </div>

            <div>
                <strong>${escapeHtml(tagStats.photos)}</strong>
                <span>tagged photos</span>
            </div>

            <div>
                <strong>${escapeHtml(linkCount)}</strong>
                <span>video scene links</span>
            </div>

            <div>
                <strong>${escapeHtml(organizedLabel)}</strong>
                <span>mark organized</span>
            </div>
        `;
    }

    function reviewStepElements() {
        return Array.from(
            document.querySelectorAll(
                ".ppics-review-step"
            )
        ).filter(
            function (section) {
                return !section.classList.contains(
                    "ppics-review-step-disabled"
                );
            }
        );
    }

    function showReviewStep(
        index
    ) {
        const sections =
            reviewStepElements();

        if (!sections.length) {
            return;
        }

        if (index < 0) {
            index = 0;
        }

        if (
            index >= sections.length
        ) {
            index =
                sections.length - 1;
        }

        reviewWizardStep =
            index;

        sections.forEach(
            function (section, sectionIndex) {
                section.classList.toggle(
                    "ppics-review-step-active",
                    sectionIndex === index
                );
            }
        );

        document.querySelectorAll(
            ".ppics-review-stepper-item"
        ).forEach(function (item, itemIndex) {
            item.classList.toggle(
                "ppics-review-stepper-active",
                itemIndex === index
            );

            item.classList.toggle(
                "ppics-review-stepper-complete",
                itemIndex < index
            );
        });

        const active =
            sections[
                index
            ];

        active.classList.remove(
            "ppics-review-step-enter"
        );

        void active.offsetWidth;

        active.classList.add(
            "ppics-review-step-enter"
        );

        const stepId =
            active.dataset.reviewStepId
            || "";

        if (
            stepId ===
            "image-tags"
        ) {
            refreshImageTagResolution();
        }

        if (
            stepId ===
            "final"
        ) {
            refreshFinalReviewSummary();
        }

        const backButton =
            document.getElementById(
                "ppics-review-back"
            );

        const nextButton =
            document.getElementById(
                "ppics-review-next"
            );

        if (backButton) {
            if (index === 0) {
                backButton.textContent =
                    "← Back to selection";
            } else {
                backButton.textContent =
                    "← Previous";
            }
        }

        if (nextButton) {
            if (
                index ===
                sections.length - 1
            ) {
                nextButton.textContent =
                    "Confirm import";
                nextButton.classList.add(
                    "btn-success"
                );
                nextButton.classList.remove(
                    "btn-primary"
                );
            } else {
                const nextTitle =
                    sections[
                        index + 1
                    ].querySelector(
                        "h3"
                    );

                let label =
                    "Next";

                if (nextTitle) {
                    label =
                        "Next: "
                        + nextTitle.textContent.trim();
                }

                nextButton.textContent =
                    label + " →";
                nextButton.classList.add(
                    "btn-primary"
                );
                nextButton.classList.remove(
                    "btn-success"
                );
            }
        }

        active.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }

    function entityRows(items, kind, createKey) {
        let html = "";

        (items || []).forEach(function (item) {
            let statusHtml = "";
            let extraHtml = "";

            if (item.exists) {
                let statusText = "Found in Stash";

                if (item.legacy_migration) {
                    statusText = "Legacy importer tag will be upgraded";
                }

                statusHtml = `
                    <span class="ppics-entity-found">
                        ${escapeHtml(statusText)}
                    </span>
                `;
            } else {
                statusHtml = `
                    <label class="ppics-create-label">
                        <input
                            type="checkbox"
                            class="ppics-create-entity"
                            data-kind="${escapeHtml(createKey)}"
                            data-name="${escapeHtml(item.name)}"
                        >
                        Create in Stash
                    </label>
                `;

                if (
                    kind === "Performer" ||
                    kind === "Studio" ||
                    kind === "Tag"
                ) {
                    let mapKind = createKey;
                    let noun = kind.toLowerCase();

                    extraHtml = `
                        <div
                            class="ppics-tag-map ppics-entity-map"
                            data-map-kind="${escapeHtml(mapKind)}"
                            data-source-name="${escapeHtml(item.name)}"
                        >
                            <div class="ppics-tag-map-heading">
                                Or use an existing Stash
                                ${escapeHtml(noun)} and add
                                <strong>${escapeHtml(item.name)}</strong>
                                as an alias
                            </div>

                            <div class="ppics-tag-search-wrap">
                                <input
                                    type="text"
                                    class="form-control ppics-tag-search-input ppics-entity-search-input"
                                    placeholder="Search existing Stash ${escapeHtml(noun)}s"
                                    autocomplete="off"
                                >

                                <input
                                    type="hidden"
                                    class="ppics-tag-mapped-id ppics-entity-mapped-id"
                                >

                                <div class="ppics-tag-search-results ppics-entity-search-results"></div>
                            </div>

                            <div class="ppics-tag-mapped-state ppics-entity-mapped-state"></div>
                        </div>
                    `;
                }
            }

            let genderChip = "";

            if (kind === "Performer" && item.gender_group) {
                genderChip = performerChipHtml({
                    name: item.gender || "Unknown",
                    gender_group: item.gender_group
                });
            }

            html += `
                <div
                    class="ppics-entity-row"
                    data-entity-kind="${escapeHtml(createKey)}"
                    data-entity-name="${escapeHtml(item.name)}"
                    data-entity-exists="${escapeHtml(String(Boolean(item.exists)))}"
                    data-entity-id="${escapeHtml(item.id || "")}"
                >
                    <div class="ppics-entity-main">
                        <strong>${escapeHtml(item.name)}</strong>
                        <div class="ppics-entity-subline">
                            <span class="text-muted">${escapeHtml(kind)}</span>
                            ${genderChip}
                        </div>
                    </div>

                    <div class="ppics-entity-action">
                        ${statusHtml}
                    </div>

                    ${extraHtml}
                </div>
            `;
        });

        if (!html) {
            html = `<div class="text-muted">None</div>`;
        }

        return html;
    }

    function renderReviewReady(
        preflight,
        groups,
        addHistory
    ) {
        stopLoadingSequence();
        currentPreflight =
            preflight;

        reviewWizardStep =
            0;

        const entities =
            preflight.entities
            || {};

        let galleryWarning = "";
        let largeImportWarning = "";
        let performerMetadataSection = "";
        let studioMetadataSection = "";
        let tagMetadataSection = "";

        if (!preflight.skip_performers) {
            performerMetadataSection = `
                <div class="ppics-entity-section">
                    <h4>Performers</h4>
                    ${entityRows(
                        entities.performers,
                        "Performer",
                        "performer"
                    )}
                </div>
            `;
        }

        if (!preflight.skip_studio) {
            studioMetadataSection = `
                <div class="ppics-entity-section">
                    <h4>Studios</h4>
                    ${entityRows(
                        entities.studios,
                        "Studio",
                        "studio"
                    )}
                </div>
            `;
        }

        if (!preflight.skip_tags) {
            tagMetadataSection = `
                <div
                    class="ppics-entity-section"
                    data-ppics-metadata-tags
                >
                    <h4>Tags</h4>
                    ${entityRows(
                        entities.tags,
                        "Tag",
                        "tag"
                    )}
                </div>
            `;
        }

        if (selectedCount() > 50) {
            largeImportWarning = `
                <div class="alert alert-warning ppics-large-import-warning">
                    <strong>Large import</strong>
                    <span>
                        You selected ${escapeHtml(selectedCount())} photos.
                        Downloads can take longer on slower internet connections.
                        The import screen will show a live time estimate.
                    </span>
                </div>
            `;
        }

        if (preflight.create_galleries_from_folders) {
            galleryWarning = `
                <div class="alert alert-secondary ppics-soft-alert">
                    Folder galleries are enabled in Stash. PornPics Importer
                    will reuse the scanned folder gallery and apply the selected
                    PornPics metadata to it.
                </div>
            `;
        }

        reviewTagMode =
            "custom";

        const steps =
            reviewStepDefinitions(
                preflight
            );

        let tagHandlingStep = "";
        let metadataStep = "";

        if (!preflight.skip_tags) {
            tagHandlingStep =
                reviewStepSection(
                    "tag-handling",
                    "Choose tag handling",
                    "Choose how PornPics scene tags should be handled for this import before doing any tag matching.",
                    tagHandlingStepHtml()
                );
        }

        if (
            !preflight.skip_performers
            || !preflight.skip_studio
            || !preflight.skip_tags
        ) {
            metadataStep =
                reviewStepSection(
                    "metadata",
                    "Match metadata",
                    "Resolve the enabled PornPics metadata against Stash. Tag matching is only shown when the selected tag handling mode needs it.",
                    `
                        <div class="ppics-metadata-review">
                            ${performerMetadataSection}
                            ${studioMetadataSection}
                            ${tagMetadataSection}
                        </div>
                    `
                );
        }

        let imageTagStep = "";

        if (!preflight.skip_tags) {
            imageTagStep =
                reviewStepSection(
                    "image-tags",
                    "Assign image tags",
                    "Tag matching is complete. Inspect each selected image and choose only the resolved tags that visually belong to it.",
                    `
                        <div class="ppics-review-list">
                            ${reviewImageTagScenesHtml(groups)}
                        </div>
                    `
                );
        }

        const sceneOptionsStep =
            reviewStepSection(
                "scene-options",
                "Scene options",
                "Choose gallery covers, optional matching Stash video scenes, and final import behavior.",
                `
                    <label class="ppics-organized-option">
                        <input
                            type="checkbox"
                            id="ppics-mark-organized"
                        >

                        <span>
                            <strong>
                                Mark imported items as organized in Stash
                            </strong>

                            <small>
                                Applies to created or updated galleries and imported images.
                            </small>
                        </span>
                    </label>

                    ${galleryWarning}

                    <div class="ppics-review-list">
                        ${reviewSceneOptionsHtml(groups)}
                    </div>
                `
            );

        const finalStep =
            reviewStepSection(
                "final",
                "Final review",
                "Check the import summary below. You can still go back to any previous step before starting the import.",
                `
                    ${largeImportWarning}

                    <div class="ppics-review-summary">
                        <div>
                            <strong>${selectedCount()}</strong>
                            <span>photos</span>
                        </div>

                        <div>
                            <strong>${escapeHtml(groups.length)}</strong>
                            <span>scenes</span>
                        </div>

                        <div class="ppics-output-path">
                            <span>Download folder</span>
                            <strong>${escapeHtml(preflight.output_path)}</strong>
                        </div>
                    </div>

                    <div
                        class="ppics-final-review-decisions"
                        id="ppics-final-review-decisions"
                    ></div>

                    <div class="ppics-review-final-scenes">
                        ${reviewFinalScenesHtml(groups)}
                    </div>
                `
            );

        setContent(`
            <div class="ppics-browser ppics-review-wizard p-3">
                <div class="ppics-hero">
                    <div>
                        <div class="ppics-eyebrow">
                            PornPics Importer
                        </div>

                        <h2>Review import</h2>

                        <div class="ppics-hero-subtitle">
                            Complete the steps below before starting the import
                        </div>
                    </div>

                    <div class="ppics-hero-badge">
                        ${escapeHtml(pp_VERSION)}
                    </div>
                </div>

                ${reviewStepperHtml(steps)}

                <div class="ppics-review-step-shell">
                    ${tagHandlingStep}
                    ${metadataStep}
                    ${imageTagStep}
                    ${sceneOptionsStep}
                    ${finalStep}
                </div>

                <div class="ppics-toolbar ppics-review-footer">
                    <button
                        type="button"
                        id="ppics-review-back"
                        class="btn btn-secondary"
                    >
                        ← Back to selection
                    </button>

                    <button
                        type="button"
                        id="ppics-review-next"
                        class="btn btn-primary"
                    >
                        Next →
                    </button>
                </div>
            </div>
        `);

        bindReviewControls();
        showReviewStep(
            0
        );

        if (addHistory !== false) {
            recordView({
                type: "review",
                preflight: preflight,
                groups: groups
            });
        }
    }


    function bindReviewControls() {
        const backButton =
            document.getElementById(
                "ppics-review-back"
            );

        const nextButton =
            document.getElementById(
                "ppics-review-next"
            );

        if (backButton) {
            backButton.addEventListener(
                "click",
                function () {
                    if (
                        reviewWizardStep ===
                        0
                    ) {
                        navigateInternal(
                            -1
                        );
                        return;
                    }

                    showReviewStep(
                        reviewWizardStep - 1
                    );
                }
            );
        }

        if (nextButton) {
            nextButton.addEventListener(
                "click",
                function () {
                    const sections =
                        reviewStepElements();

                    if (
                        reviewWizardStep >=
                        sections.length - 1
                    ) {
                        confirmImport();
                        return;
                    }

                    showReviewStep(
                        reviewWizardStep + 1
                    );
                }
            );
        }

        bindSceneCandidateSelects();
        bindEntityMapControls();
        bindImageTagControls();
        bindTagModeControls();
    }


    function sceneCandidateById(sceneUrl, sceneId) {
        const preflightScene = preflightSceneByUrl(sceneUrl);

        if (!preflightScene) {
            return null;
        }

        let result = null;

        (preflightScene.video_candidates || []).forEach(function (candidate) {
            if (String(candidate.id) === String(sceneId)) {
                result = candidate;
            }
        });

        return result;
    }

    function renderSceneCandidatePreview(select) {
        const sceneUrl = select.dataset.sceneUrl;
        const preview = document.querySelector(
            '.ppics-scene-link-preview[data-scene-url="' +
            CSS.escape(sceneUrl) +
            '"]'
        );

        if (!preview) {
            return;
        }

        if (!select.value) {
            preview.innerHTML = `
                <div class="ppics-scene-link-empty">
                    No video scene selected
                </div>
            `;
            return;
        }

        const candidate = sceneCandidateById(
            sceneUrl,
            select.value
        );

        if (!candidate) {
            return;
        }

        let screenshot = "";

        if (candidate.paths && candidate.paths.screenshot) {
            screenshot = `
                <img
                    src="${escapeHtml(candidate.paths.screenshot)}"
                    alt="${escapeHtml(candidate.title)}"
                >
            `;
        }

        let performers = "";

        (candidate.performers || []).slice(0, 3).forEach(function (performer) {
            performers += `
                <span>${escapeHtml(performer.name)}</span>
            `;
        });

        let studioName = "Unknown studio";

        if (
            candidate.studio &&
            candidate.studio.name
        ) {
            studioName = candidate.studio.name;
        }

        preview.innerHTML = `
            ${screenshot}

            <div class="ppics-scene-link-copy">
                <strong>${escapeHtml(candidate.title || "Untitled scene")}</strong>
                <div class="text-muted">
                    ${escapeHtml(studioName)}
                </div>
                <div class="ppics-scene-link-performers">
                    ${performers}
                </div>
            </div>
        `;
    }

    function bindSceneCandidateSelects() {
        document.querySelectorAll(".ppics-scene-link-select")
            .forEach(function (select) {
                renderSceneCandidatePreview(select);

                select.addEventListener("change", function () {
                    renderSceneCandidatePreview(select);
                });
            });
    }
    async function searchStashEntities(kind, queryText) {
        let query = "";
        let resultKey = "";

        if (kind === "performer") {
            query = `
                query PPicsPerformerSearch($filter: FindFilterType) {
                    findPerformers(filter: $filter) {
                        performers {
                            id
                            name
                            alias_list
                            gender
                            image_path
                        }
                    }
                }
            `;

            resultKey = "findPerformers";
        }

        if (kind === "studio") {
            query = `
                query PPicsStudioSearch($filter: FindFilterType) {
                    findStudios(filter: $filter) {
                        studios {
                            id
                            name
                            aliases
                            image_path
                        }
                    }
                }
            `;

            resultKey = "findStudios";
        }

        if (kind === "tag") {
            query = `
                query PPicsTagSearch($filter: FindFilterType) {
                    findTags(filter: $filter) {
                        tags {
                            id
                            name
                            aliases
                        }
                    }
                }
            `;

            resultKey = "findTags";
        }

        if (!query) {
            return [];
        }

        const response = await fetch("/graphql", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "same-origin",
            body: JSON.stringify({
                query: query,
                variables: {
                    filter: {
                        q: queryText,
                        per_page: 12
                    }
                }
            })
        });

        const result = await response.json();

        if (result.errors && result.errors.length) {
            throw new Error(
                result.errors.map(function (error) {
                    return error.message;
                }).join(", ")
            );
        }

        if (!result.data || !result.data[resultKey]) {
            return [];
        }

        if (kind === "performer") {
            return result.data[resultKey].performers || [];
        }

        if (kind === "studio") {
            return result.data[resultKey].studios || [];
        }

        return result.data[resultKey].tags || [];
    }

    function entityAliases(kind, item) {
        if (kind === "performer") {
            return item.alias_list || [];
        }

        return item.aliases || [];
    }

    function entitySearchSecondary(kind, item) {
        const aliases = entityAliases(kind, item);
        let secondary = aliases.join(", ");

        if (
            kind === "performer" &&
            item.gender
        ) {
            if (secondary) {
                secondary += " · ";
            }

            secondary += item.gender;
        }

        return secondary;
    }

    function bindEntityMapControls() {
        document.querySelectorAll(".ppics-entity-map")
            .forEach(function (container) {
                const input = container.querySelector(
                    ".ppics-entity-search-input"
                );
                const results = container.querySelector(
                    ".ppics-entity-search-results"
                );
                const mappedId = container.querySelector(
                    ".ppics-entity-mapped-id"
                );
                const state = container.querySelector(
                    ".ppics-entity-mapped-state"
                );
                const row = container.closest(".ppics-entity-row");
                const createInput = row.querySelector(
                    ".ppics-create-entity"
                );
                const kind = container.dataset.mapKind;

                let timer = null;

                input.addEventListener("input", function () {
                    if (timer) {
                        window.clearTimeout(timer);
                    }

                    const value = input.value.trim();

                    if (value.length < 2) {
                        results.innerHTML = "";
                        results.classList.remove("ppics-is-open");
                        return;
                    }

                    timer = window.setTimeout(async function () {
                        try {
                            const items = await searchStashEntities(
                                kind,
                                value
                            );

                            let html = "";

                            items.forEach(function (item) {
                                html += `
                                    <button
                                        type="button"
                                        class="ppics-tag-search-result ppics-entity-search-result"
                                        data-entity-id="${escapeHtml(item.id)}"
                                        data-entity-name="${escapeHtml(item.name)}"
                                    >
                                        <strong>${escapeHtml(item.name)}</strong>
                                        <span>${escapeHtml(entitySearchSecondary(kind, item))}</span>
                                    </button>
                                `;
                            });

                            if (!html) {
                                html = `
                                    <div class="ppics-tag-search-empty">
                                        No matching Stash entries
                                    </div>
                                `;
                            }

                            results.innerHTML = html;
                            results.classList.add("ppics-is-open");

                            results.querySelectorAll(".ppics-entity-search-result")
                                .forEach(function (button) {
                                    button.addEventListener("click", function () {
                                        mappedId.value =
                                            button.dataset.entityId;

                                        input.value =
                                            button.dataset.entityName;

                                        results.classList.remove("ppics-is-open");
                                        results.innerHTML = "";

                                        if (createInput) {
                                            createInput.checked = false;
                                            createInput.disabled = true;
                                        }

                                        state.innerHTML = `
                                            <div class="ppics-tag-mapped-chip">
                                                Using
                                                <strong>
                                                    ${escapeHtml(button.dataset.entityName)}
                                                </strong>

                                                <button
                                                    type="button"
                                                    class="ppics-tag-map-clear"
                                                    aria-label="Clear mapping"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        `;

                                        state.querySelector(".ppics-tag-map-clear")
                                            .addEventListener("click", function () {
                                                mappedId.value = "";
                                                input.value = "";
                                                state.innerHTML = "";

                                                if (createInput) {
                                                    createInput.disabled = false;
                                                }
                                            });
                                    });
                                });
                        } catch (error) {
                            console.error(error);
                        }
                    }, 250);
                });
            });
    }


    async function startReview() {
        if (selectedCount() === 0) {
            return;
        }

        const groups = groupedSelections();
        const stop = startLoadingSequence(
            "Preparing import review",
            [
                "Gathering selected scenes",
                "Parsing PornPics metadata",
                "Matching enabled Stash metadata",
                "Searching Stash for matching video scenes",
                "Preparing cover choices"
            ],
            String(selectedCount()) + " selected photos"
        );

        try {
            const preflight = await requestData(
                {
                    mode: "preflight_import",
                    performer: currentContextPerformer(),
                    context_type: currentContextType(),
                    context_value: currentContextValue(),
                    selection_json: JSON.stringify(selectionPayload())
                },
                updateLoadingFromProgress
            );

            stop();
            currentPreflight = preflight;
            renderReviewReady(preflight, groups, true);
        } catch (error) {
            console.error(error);
            renderError(error);
        }
    }

    function collectImportOptions() {
        const result = {
            create_performers: [],
            create_studios: [],
            create_tags: [],
            performer_aliases: {},
            studio_aliases: {},
            tag_aliases: {},
            scene_links: {},
            covers: {},
            image_tag_assignments: {},
            tag_mode: reviewTagMode,
            organized: false
        };

        document.querySelectorAll(".ppics-create-entity")
            .forEach(function (input) {
                if (!input.checked) {
                    return;
                }

                const kind = input.dataset.kind;
                const name = input.dataset.name;

                if (
                    kind === "tag"
                    && reviewTagMode === "none"
                ) {
                    return;
                }

                if (kind === "performer") {
                    result.create_performers.push(name);
                }

                if (kind === "studio") {
                    result.create_studios.push(name);
                }

                if (kind === "tag") {
                    result.create_tags.push(name);
                }
            });

        document.querySelectorAll(".ppics-entity-map")
            .forEach(function (container) {
                const source =
                    container.dataset.sourceName;

                const kind =
                    container.dataset.mapKind;

                const mappedId =
                    container.querySelector(
                        ".ppics-entity-mapped-id"
                    );

                if (
                    !source ||
                    !kind ||
                    !mappedId ||
                    !mappedId.value
                ) {
                    return;
                }

                if (
                    kind === "tag"
                    && reviewTagMode === "none"
                ) {
                    return;
                }

                if (kind === "performer") {
                    result.performer_aliases[source] =
                        mappedId.value;
                }

                if (kind === "studio") {
                    result.studio_aliases[source] =
                        mappedId.value;
                }

                if (kind === "tag") {
                    result.tag_aliases[source] =
                        mappedId.value;
                }
            });

        document.querySelectorAll(
            ".ppics-image-tag-review"
        ).forEach(function (container) {
            const sceneUrl =
                container.dataset.sceneUrl;

            if (!sceneUrl) {
                return;
            }

            const imageMap = {};

            container.querySelectorAll(
                ".ppics-image-tag-image"
            ).forEach(function (imageRow) {
                const sourceUrl =
                    imageRow.dataset.sourceUrl;

                if (!sourceUrl) {
                    return;
                }

                const names = [];

                imageRow.querySelectorAll(
                    ".ppics-image-tag-checkbox"
                ).forEach(function (input) {
                    if (input.checked) {
                        names.push(
                            input.dataset.tagName
                        );
                    }
                });

                imageMap[
                    sourceUrl
                ] = names;
            });

            result.image_tag_assignments[
                sceneUrl
            ] = imageMap;
        });

        document.querySelectorAll(".ppics-scene-link-select")
            .forEach(function (select) {
                if (select.value) {
                    result.scene_links[select.dataset.sceneUrl] = select.value;
                }
            });

        document.querySelectorAll(".ppics-cover-radio")
            .forEach(function (input) {
                if (input.checked) {
                    result.covers[input.dataset.sceneUrl] = input.dataset.sourceUrl;
                }
            });

        const organized = document.getElementById("ppics-mark-organized");

        if (organized) {
            result.organized = organized.checked;
        }

        return result;
    }

    function showConfirmDialog(photoCount, sceneCount) {
        return new Promise(function (resolve) {
            const overlay = document.createElement("div");
            overlay.className = "ppics-confirm-overlay";

            let largeWarning = "";

            if (photoCount > 50) {
                largeWarning = `
                    <div class="ppics-confirm-large-warning">
                        <strong>Large import</strong>
                        <span>
                            ${escapeHtml(photoCount)} photos may take a while to
                            download, especially on a slower connection.
                        </span>
                    </div>
                `;
            }

            overlay.innerHTML = `
                <div class="ppics-confirm-dialog" role="dialog" aria-modal="true">
                    <div class="ppics-eyebrow">PornPics Importer</div>
                    <h3>Start this import</h3>

                    <p>
                        Are you sure you want to import
                        <strong>${escapeHtml(photoCount)} photos</strong>
                        from
                        <strong>${escapeHtml(sceneCount)} scenes</strong>
                        into Stash.
                    </p>

                    ${largeWarning}

                    <div class="ppics-confirm-actions">
                        <button
                            type="button"
                            class="btn btn-secondary ppics-confirm-cancel"
                        >
                            Cancel
                        </button>

                        <button
                            type="button"
                            class="btn btn-primary ppics-confirm-yes"
                        >
                            Import photos
                        </button>
                    </div>
                </div>
            `;

            function keyHandler(event) {
                if (event.key === "Escape") {
                    finish(false);
                }
            }

            function finish(value) {
                document.removeEventListener(
                    "keydown",
                    keyHandler
                );

                overlay.remove();
                resolve(value);
            }

            overlay.querySelector(".ppics-confirm-cancel")
                .addEventListener("click", function () {
                    finish(false);
                });

            overlay.querySelector(".ppics-confirm-yes")
                .addEventListener("click", function () {
                    finish(true);
                });

            overlay.addEventListener("click", function (event) {
                if (event.target === overlay) {
                    finish(false);
                }
            });

            document.body.appendChild(overlay);
            document.addEventListener(
                "keydown",
                keyHandler
            );

            const yesButton = overlay.querySelector(
                ".ppics-confirm-yes"
            );

            if (yesButton) {
                yesButton.focus();
            }
        });
    }

    function formatDuration(seconds) {
        let value = Math.max(
            0,
            Math.round(
                Number(seconds) || 0
            )
        );

        if (value < 60) {
            return String(value) + "s";
        }

        const minutes = Math.floor(
            value / 60
        );

        const remainingSeconds =
            value % 60;

        if (minutes < 60) {
            return (
                String(minutes) +
                "m " +
                String(remainingSeconds) +
                "s"
            );
        }

        const hours = Math.floor(
            minutes / 60
        );

        const remainingMinutes =
            minutes % 60;

        return (
            String(hours) +
            "h " +
            String(remainingMinutes) +
            "m"
        );
    }

    function formatBytes(bytes) {
        const value = Number(bytes) || 0;

        if (value < 1024) {
            return String(value) + " B";
        }

        if (value < 1024 * 1024) {
            return (
                (value / 1024).toFixed(1) +
                " KB"
            );
        }

        if (value < 1024 * 1024 * 1024) {
            return (
                (value / 1024 / 1024).toFixed(1) +
                " MB"
            );
        }

        return (
            (value / 1024 / 1024 / 1024).toFixed(2) +
            " GB"
        );
    }

    function stopImportProgressClock() {
        if (importProgressClock) {
            window.clearInterval(
                importProgressClock
            );

            importProgressClock = null;
        }
    }

    function resetImportProgressStats(totalPhotos) {
        stopImportProgressClock();

        importProgressStats = {
            startedAt: Date.now(),
            totalPhotos: Number(totalPhotos) || 0,
            phase: "gather",
            downloadStartedAt: null,
            downloadCompleted: 0,
            downloadTotal: Number(totalPhotos) || 0,
            downloadedBytes: 0,
            lastDownloadSampleAt: null,
            lastDownloadSampleCount: 0,
            averageSecondsPerImage: null,
            scanStartedAt: null,
            scanFraction: 0,
            etaSeconds: null,
            etaPhase: null
        };

        importProgressClock = window.setInterval(
            updateImportTimingDisplay,
            1000
        );
    }

    function smoothEtaEstimate(value) {
        if (
            !importProgressStats
            || value === null
        ) {
            return value;
        }

        const stats = importProgressStats;
        const phase = stats.phase;

        if (
            stats.etaPhase !== phase
            || stats.etaSeconds === null
        ) {
            stats.etaPhase = phase;
            stats.etaSeconds = value;
            return value;
        }

        if (value <= 0) {
            stats.etaSeconds = 0;
            return 0;
        }

        const previous = Math.max(
            0,
            Number(stats.etaSeconds) || 0
        );

        const maximumChange = Math.max(
            6,
            previous * 0.3
        );

        const difference =
            value - previous;

        const limitedDifference = Math.max(
            -maximumChange,
            Math.min(
                maximumChange,
                difference
            )
        );

        stats.etaSeconds = Math.max(
            0,
            previous + limitedDifference * 0.45
        );

        return stats.etaSeconds;
    }

    function estimateRemainingTime() {
        if (!importProgressStats) {
            return null;
        }

        const stats = importProgressStats;
        const now = Date.now();
        let estimate = null;

        if (
            stats.phase === "download" &&
            stats.downloadStartedAt &&
            stats.downloadCompleted > 0 &&
            stats.downloadTotal > 0
        ) {
            const elapsed =
                (now - stats.downloadStartedAt) /
                1000;

            let averagePerImage =
                stats.averageSecondsPerImage;

            if (
                averagePerImage === null
                || averagePerImage <= 0
            ) {
                averagePerImage =
                    elapsed /
                    stats.downloadCompleted;
            }

            const remaining = Math.max(
                0,
                stats.downloadTotal -
                stats.downloadCompleted
            );

            estimate =
                averagePerImage *
                remaining +
                8;
        }

        if (
            estimate === null &&
            stats.phase === "scan" &&
            stats.scanStartedAt &&
            stats.scanFraction > 0.02 &&
            stats.scanFraction < 1
        ) {
            const elapsed =
                (now - stats.scanStartedAt) /
                1000;

            const totalEstimate =
                elapsed /
                stats.scanFraction;

            estimate = Math.max(
                0,
                totalEstimate - elapsed
            );
        }

        if (
            estimate === null &&
            (
                stats.phase === "metadata" ||
                stats.phase === "manifest" ||
                stats.phase === "finalize" ||
                stats.phase === "reuse"
            )
        ) {
            estimate = 15;
        }

        if (stats.phase === "complete") {
            estimate = 0;
        }

        return smoothEtaEstimate(
            estimate
        );
    }

    function updateImportTimingDisplay() {
        if (!importProgressStats) {
            return;
        }

        const elapsedNode = document.querySelector(
            ".ppics-import-elapsed"
        );

        const etaNode = document.querySelector(
            ".ppics-import-eta"
        );

        const bytesNode = document.querySelector(
            ".ppics-import-bytes"
        );

        const elapsed =
            (Date.now() - importProgressStats.startedAt) /
            1000;

        if (elapsedNode) {
            elapsedNode.textContent =
                formatDuration(
                    elapsed
                );
        }

        const eta =
            estimateRemainingTime();

        if (etaNode) {
            if (eta === null) {
                etaNode.textContent =
                    "Calculating";
            } else if (eta <= 8) {
                etaNode.textContent =
                    "Almost done";
            } else {
                etaNode.textContent =
                    "About " +
                    formatDuration(eta);
            }
        }

        if (bytesNode) {
            if (
                importProgressStats.downloadedBytes > 0
            ) {
                bytesNode.textContent =
                    formatBytes(
                        importProgressStats.downloadedBytes
                    );
            } else {
                bytesNode.textContent =
                    "Waiting";
            }
        }
    }

    function updateImportTimingStats(progress) {
        if (!importProgressStats) {
            return;
        }

        const stats = importProgressStats;
        const phase = progress.phase || stats.phase;

        stats.phase = phase;

        if (phase === "download") {
            if (!stats.downloadStartedAt) {
                stats.downloadStartedAt = Date.now();
            }

            if (
                typeof progress.total === "number" &&
                progress.total > 0
            ) {
                stats.downloadTotal = progress.total;
            }

            if (
                typeof progress.completed === "number" &&
                progress.completed >= 0
            ) {
                const completed =
                    progress.completed;

                if (
                    completed >
                    stats.lastDownloadSampleCount
                ) {
                    const sampleNow = Date.now();
                    const countDelta =
                        completed -
                        stats.lastDownloadSampleCount;

                    if (stats.lastDownloadSampleAt) {
                        const seconds = Math.max(
                            0.05,
                            (
                                sampleNow -
                                stats.lastDownloadSampleAt
                            ) / 1000
                        );

                        const sample =
                            seconds /
                            countDelta;

                        if (
                            stats.averageSecondsPerImage === null
                        ) {
                            stats.averageSecondsPerImage =
                                sample;
                        } else {
                            stats.averageSecondsPerImage =
                                stats.averageSecondsPerImage * 0.72 +
                                sample * 0.28;
                        }
                    }

                    stats.lastDownloadSampleAt =
                        sampleNow;
                    stats.lastDownloadSampleCount =
                        completed;
                }

                stats.downloadCompleted =
                    completed;
            }

            if (
                typeof progress.bytes_done === "number" &&
                progress.bytes_done >= 0
            ) {
                stats.downloadedBytes = progress.bytes_done;
            }
        }

        if (phase === "scan") {
            if (!stats.scanStartedAt) {
                stats.scanStartedAt = Date.now();
            }

            if (
                typeof progress.current === "number" &&
                typeof progress.total === "number" &&
                progress.total > 0
            ) {
                stats.scanFraction = Math.max(
                    0,
                    Math.min(
                        1,
                        progress.current /
                        progress.total
                    )
                );
            }
        }

        updateImportTimingDisplay();
    }

    const importStepOrder = {
        gather: 0,
        download: 1,
        metadata: 2,
        manifest: 3,
        scan: 4,
        reuse: 4,
        finalize: 5,
        complete: 6
    };

    const importSteps = [
        "Gather data",
        "Download images",
        "Resolve metadata",
        "Save import plan",
        "Scan in Stash",
        "Apply metadata",
        "Complete"
    ];

    function showImportProgress(totalPhotos) {
        resetImportProgressStats(totalPhotos);
        setContent(`
            <div class="ppics-browser p-3">
                <div class="ppics-import-progress-shell">
                    <div class="ppics-import-progress-card">
                        <div class="ppics-import-progress-head">
                            <div class="ppics-loading-orbit">
                                <div class="spinner-border ppics-loading-spinner"></div>
                            </div>

                            <div>
                                <div class="ppics-eyebrow">
                                    PornPics Importer
                                </div>
                                <h2>Import in progress</h2>
                                <div class="ppics-import-progress-message">
                                    Gathering data
                                </div>
                                <div class="ppics-import-progress-detail text-muted"></div>
                            </div>
                        </div>

                        <div class="ppics-import-timing">
                            <div>
                                <span>Elapsed</span>
                                <strong class="ppics-import-elapsed">0s</strong>
                            </div>

                            <div>
                                <span>Estimated time left</span>
                                <strong class="ppics-import-eta">Calculating</strong>
                            </div>

                            <div>
                                <span>Downloaded data</span>
                                <strong class="ppics-import-bytes">Waiting</strong>
                            </div>
                        </div>

                        <div class="ppics-import-meter-wrap">
                            <div class="ppics-import-meter">
                                <div class="ppics-import-meter-fill"></div>
                            </div>
                            <div class="ppics-import-meter-text"></div>
                        </div>

                        <div class="ppics-import-steps">
                            ${importSteps.map(function (step, index) {
                                return `
                                    <div
                                        class="ppics-import-step"
                                        data-step-index="${index}"
                                    >
                                        <span class="ppics-import-step-dot"></span>
                                        <span>${escapeHtml(step)}</span>
                                    </div>
                                `;
                            }).join("")}
                        </div>
                    </div>
                </div>
            </div>
        `);
    }

    function updateImportProgress(progress) {
        updateImportTimingStats(progress);

        const message = document.querySelector(
            ".ppics-import-progress-message"
        );
        const detail = document.querySelector(
            ".ppics-import-progress-detail"
        );
        const fill = document.querySelector(
            ".ppics-import-meter-fill"
        );
        const meterText = document.querySelector(
            ".ppics-import-meter-text"
        );

        if (message && progress.message) {
            message.textContent = progress.message;

            if (
                progress.phase === "download" &&
                typeof progress.current === "number" &&
                typeof progress.total === "number" &&
                progress.total > 0
            ) {
                message.textContent =
                    progress.message +
                    " " +
                    String(progress.current) +
                    " of " +
                    String(progress.total);
            }
        }

        let detailText = progress.detail || "";
        let percentage = null;

        if (
            typeof progress.current === "number" &&
            typeof progress.total === "number" &&
            progress.total > 0
        ) {
            if (detailText) {
                detailText += " · ";
            }

            detailText +=
                String(progress.current) +
                " / " +
                String(progress.total);

            percentage = Math.round(
                progress.current / progress.total * 100
            );
        }

        if (
            typeof progress.bytes_done === "number" &&
            progress.bytes_done > 0
        ) {
            if (detailText) {
                detailText += " · ";
            }

            detailText +=
                formatBytes(
                    progress.bytes_done
                ) +
                " downloaded";
        }

        if (detail) {
            detail.textContent = detailText;
        }

        if (fill && percentage !== null) {
            fill.style.width = String(percentage) + "%";
        }

        if (meterText) {
            if (percentage !== null) {
                meterText.textContent =
                    String(percentage) +
                    "%";
            } else {
                meterText.textContent = "";
            }
        }

        let currentStep = importStepOrder[progress.phase];

        if (typeof currentStep !== "number") {
            currentStep = 0;
        }

        document.querySelectorAll(".ppics-import-step")
            .forEach(function (element) {
                const index = Number(element.dataset.stepIndex);
                element.classList.remove(
                    "ppics-step-current",
                    "ppics-step-done"
                );

                if (index < currentStep) {
                    element.classList.add("ppics-step-done");
                }

                if (index === currentStep) {
                    element.classList.add("ppics-step-current");
                }
            });
    }

    function updateScanProgress(job) {
        let progress = 0;

        if (
            typeof job.progress === "number" &&
            job.progress >= 0
        ) {
            progress = job.progress;
        }

        updateImportProgress({
            phase: "scan",
            message: "Scanning downloaded files in Stash",
            current: Math.round(progress * 100),
            total: 100,
            detail: "Status: " + job.status
        });
    }

    async function confirmImport() {
        if (!currentPreflight) {
            return;
        }

        const groups = groupedSelections();
        const confirmed = await showConfirmDialog(
            selectedCount(),
            groups.length
        );

        if (!confirmed) {
            return;
        }

        const options = collectImportOptions();
        const payload = selectionPayload();

        lastImportOptions = options;
        lastImportSelectionPayload = Array.from(
            payload
        );
        lastFailedSelections = [];

        try {
            showImportProgress(selectedCount());
            updateImportProgress({
                phase: "gather",
                message: "Gathering PornPics data",
                detail: "Preparing selected scenes"
            });

            const prepared = await requestData(
                {
                    mode: "prepare_import",
                    performer: currentContextPerformer(),
                    context_type: currentContextType(),
                    context_value: currentContextValue(),
                    selection_json: JSON.stringify(payload),
                    create_json: JSON.stringify(options)
                },
                updateImportProgress
            );

            lastFailedSelections = Array.from(
                prepared.failed || []
            );

            if (prepared.scan_job_id) {
                updateImportProgress({
                    phase: "scan",
                    message: "Starting Stash scan",
                    detail: "Waiting for Stash to index the new images"
                });

                await waitForJob(
                    prepared.scan_job_id,
                    updateScanProgress
                );
            } else {
                updateImportProgress({
                    phase: "reuse",
                    message: "Reusing existing Stash images",
                    detail: "No new files need to be scanned"
                });
            }

            updateImportProgress({
                phase: "finalize",
                message: "Applying final Stash metadata",
                detail: "Linking galleries, image metadata, covers and video scenes"
            });

            const finalized = await requestData(
                {
                    mode: "finalize_import",
                    import_id: prepared.import_id
                },
                updateImportProgress
            );

            updateImportProgress({
                phase: "complete",
                message: "Import complete",
                current: 1,
                total: 1
            });

            window.setTimeout(function () {
                renderImportDone(prepared, finalized);
            }, 350);
        } catch (error) {
            console.error(error);
            renderImportFailure(error);
        }
    }

    function resultLinkList(items, type) {
        let html = "";

        (items || []).forEach(function (item) {
            let route = "/images/" + item.id;

            if (type === "gallery") {
                route = "/galleries/" + item.id;
            }

            let title = item.title || "Untitled";

            html += `
                <a
                    class="btn btn-secondary ppics-result-link"
                    href="${escapeHtml(route)}"
                >
                    <span>${escapeHtml(title)}</span>
                    <span>Open →</span>
                </a>
            `;
        });

        return html;
    }

    function friendlyImportIssue(raw) {
        const text = String(
            raw || ""
        );
        const lower = text.toLowerCase();

        if (
            lower.indexOf("access is denied") >= 0 ||
            lower.indexOf("permission") >= 0
        ) {
            return "Windows blocked access to the file or folder.";
        }

        if (
            lower.indexOf("timed out") >= 0 ||
            lower.indexOf("timeout") >= 0
        ) {
            return "The download took too long and timed out.";
        }

        if (
            lower.indexOf("404") >= 0 ||
            lower.indexOf("not found") >= 0
        ) {
            return "The source image could not be found.";
        }

        if (
            lower.indexOf("ssl") >= 0 ||
            lower.indexOf("certificate") >= 0
        ) {
            return "The secure connection to the source failed.";
        }

        if (
            lower.indexOf("graphql") >= 0 ||
            lower.indexOf("metadata") >= 0
        ) {
            return "Stash could not apply metadata to this image.";
        }

        return "This photo could not be completed.";
    }

    function importIssueDetailsHtml(
        failedDownloads,
        missing
    ) {
        const issues = [];

        (failedDownloads || []).forEach(
            function (item) {
                issues.push({
                    title:
                        item.sceneTitle ||
                        imageFilename(item.imageUrl) ||
                        "PornPics photo",
                    source:
                        item.imageUrl || "",
                    error:
                        item.error ||
                        "Download failed"
                });
            }
        );

        (missing || []).forEach(
            function (item) {
                issues.push({
                    title:
                        imageFilename(
                            item.source_url
                        ) ||
                        "PornPics photo",
                    source:
                        item.source_url ||
                        item.path || "",
                    error:
                        item.error ||
                        "Stash could not find the scanned image"
                });
            }
        );

        if (!issues.length) {
            return "";
        }

        let rows = "";

        issues.slice(
            0,
            25
        ).forEach(function (item) {
            rows += `
                <div class="ppics-import-issue-row">
                    <div class="ppics-import-issue-copy">
                        <strong>
                            ${escapeHtml(item.title)}
                        </strong>
                        <span>
                            ${escapeHtml(friendlyImportIssue(item.error))}
                        </span>
                    </div>

                    <details class="ppics-import-issue-tech">
                        <summary>Details</summary>
                        <div>${escapeHtml(item.source)}</div>
                        <pre>${escapeHtml(item.error)}</pre>
                    </details>
                </div>
            `;
        });

        let more = "";

        if (issues.length > 25) {
            more = `
                <div class="ppics-import-issue-more">
                    ${escapeHtml(issues.length - 25)} additional issue(s)
                </div>
            `;
        }

        return `
            <details class="ppics-import-issues">
                <summary>
                    Review ${escapeHtml(issues.length)} import issue(s)
                </summary>
                <div class="ppics-import-issues-list">
                    ${rows}
                    ${more}
                </div>
            </details>
        `;
    }

    function renderImportDone(prepared, finalized) {
        stopImportProgressClock();

        if (importProgressStats) {
            importProgressStats.phase = "complete";
            updateImportTimingDisplay();
        }

        const missing = finalized.missing || [];
        const failedDownloads = prepared.failed || [];
        const retryItems = Array.from(
            failedDownloads
        );

        missing.forEach(function (missingItem) {
            const sourceUrl = String(
                missingItem.source_url || ""
            );

            let match = null;

            lastImportSelectionPayload.forEach(
                function (item) {
                    if (match) {
                        return;
                    }

                    if (
                        String(item.imageUrl || "") === sourceUrl
                    ) {
                        match = item;
                        return;
                    }

                    if (
                        imageFilename(item.imageUrl) &&
                        imageFilename(item.imageUrl) === imageFilename(sourceUrl)
                    ) {
                        match = item;
                    }
                }
            );

            if (match) {
                let exists = false;

                retryItems.forEach(function (item) {
                    if (item.key === match.key) {
                        exists = true;
                    }
                });

                if (!exists) {
                    retryItems.push(match);
                }
            }
        });

        let statusHtml = `
            <div class="alert alert-success ppics-soft-alert">
                Import completed successfully.
            </div>
        `;

        if (
            missing.length ||
            failedDownloads.length
        ) {
            const issueCount =
                missing.length
                + failedDownloads.length;

            statusHtml = `
                <div class="alert alert-warning">
                    Import completed partially. ${escapeHtml(issueCount)}
                    photo(s) need attention.
                </div>
            `;
        }

        clearStoredSelections();
        closeSelectionDrawer();
        currentPreflight = null;

        const galleries = finalized.galleries || [];
        const standalone = finalized.standalone_images || [];

        (finalized.images || []).forEach(function (item) {
            if (item.source_url) {
                importedImageStatus.set(
                    item.source_url,
                    {
                        imported: true,
                        image_id: item.id,
                        gallery_id: item.gallery_id
                    }
                );
            }
        });
        let gallerySection = "";
        let imageSection = "";
        const issueSection =
            importIssueDetailsHtml(
                failedDownloads,
                missing
            );

        if (galleries.length) {
            gallerySection = `
                <div class="ppics-result-section">
                    <h3>Galleries</h3>
                    <div class="ppics-result-links">
                        ${resultLinkList(galleries, "gallery")}
                    </div>
                </div>
            `;
        }

        if (standalone.length) {
            imageSection = `
                <div class="ppics-result-section">
                    <h3>Standalone images</h3>
                    <div class="ppics-result-links">
                        ${resultLinkList(standalone, "image")}
                    </div>
                </div>
            `;
        }

        setContent(`
            <div class="ppics-browser p-3">
                <div class="ppics-hero">
                    <div>
                        <div class="ppics-eyebrow">
                            PornPics Importer
                        </div>
                        <h2>Import complete</h2>
                    </div>
                </div>

                ${statusHtml}

                <div class="ppics-import-result">
                    <div>
                        <strong>${escapeHtml(prepared.downloaded)}</strong>
                        <span>new files</span>
                    </div>
                    <div>
                        <strong>${escapeHtml(prepared.reused)}</strong>
                        <span>reused</span>
                    </div>
                    <div>
                        <strong>${escapeHtml(finalized.updated)}</strong>
                        <span>images updated</span>
                    </div>
                    <div>
                        <strong>${escapeHtml(finalized.scenes)}</strong>
                        <span>scenes processed</span>
                    </div>
                    <div>
                        <strong>${escapeHtml(failedDownloads.length)}</strong>
                        <span>failed downloads</span>
                    </div>
                </div>

                ${gallerySection}
                ${imageSection}
                ${issueSection}

                <div class="ppics-output-finished">
                    ${escapeHtml(prepared.output_path)}
                </div>

                <div class="ppics-result-actions mt-3">
                    <button
                        type="button"
                        id="ppics-retry-failed"
                        class="btn btn-secondary"
                        style="display: none"
                    >
                        Retry failed photos
                    </button>

                    <button
                        type="button"
                        id="ppics-import-back"
                        class="btn btn-primary"
                    >
                        Back to PornPics
                    </button>
                </div>
            </div>
        `);

        const retryButton = document.getElementById(
            "ppics-retry-failed"
        );

        if (
            retryButton &&
            retryItems.length
        ) {
            retryButton.style.display = "inline-flex";

            retryButton.addEventListener(
                "click",
                function () {
                    selections.clear();

                    retryItems.forEach(
                        function (item) {
                            if (item && item.key) {
                                selections.set(
                                    item.key,
                                    item
                                );
                            }
                        }
                    );

                    saveSelections();
                    refreshSelectionCounter();
                    startReview();
                }
            );
        }

        const backButton = document.getElementById("ppics-import-back");

        if (backButton) {
            backButton.addEventListener("click", function () {
                if (lastSearchData) {
                    renderScenes(lastSearchData, true);
                }
            });
        }
    }

    function renderImportFailure(error) {
        stopImportProgressClock();

        const info = explainError(
            error,
            "import"
        );

        setContent(`
            <div class="ppics-browser p-3">
                <div class="ppics-state-card ppics-state-error ppics-import-failure-card">
                    <div class="ppics-state-icon">!</div>
                    <div>
                        <div class="ppics-eyebrow">PornPics Importer</div>
                        <h2>${escapeHtml(info.title)}</h2>
                        <p>${escapeHtml(info.explanation)}</p>
                        <p class="text-muted">${escapeHtml(info.suggestion)}</p>

                        <details class="ppics-error-details">
                            <summary>Technical details</summary>
                            <pre>${escapeHtml(info.technical)}</pre>
                        </details>
                    </div>
                </div>

                <button
                    type="button"
                    id="ppics-import-failure-back"
                    class="btn btn-secondary mt-3"
                >
                    Back to review
                </button>
            </div>
        `);

        const backButton = document.getElementById(
            "ppics-import-failure-back"
        );

        if (backButton) {
            backButton.addEventListener(
                "click",
                function () {
                    if (currentPreflight) {
                        renderReviewReady(
                            currentPreflight,
                            groupedSelections(),
                            true
                        );
                    }
                }
            );
        }
    }

    async function loadPerformerPage(page) {
        if (!currentBrowseContext) {
            return;
        }

        const cacheKey = String(page);

        if (pageCache.has(cacheKey)) {
            renderScenes(
                pageCache.get(cacheKey),
                true
            );
            return;
        }

        const stop = startLoadingSequence(
            "Loading PornPics",
            [
                "Connecting to PornPics",
                "Choosing randomized results",
                "Loading scene previews",
                "Building the results page"
            ],
            "Page "
            + String(page)
            + " · "
            + String(currentBrowseContext.label || currentBrowseContext.value)
        );

        try {
            const args = {
                mode: "search_context",
                context_type:
                    currentBrowseContext.type,
                context_value:
                    currentBrowseContext.value,
                context_label:
                    currentBrowseContext.label,
                context_url:
                    currentBrowseContext.url || "",
                page: page,
                seed: paginationSeed
            };

            if (knownTotalCount) {
                args.total_count =
                    knownTotalCount;
            }

            const data = await requestData(
                args,
                updateLoadingFromProgress,
                90000
            );

            stop();

            if (data.total_count) {
                knownTotalCount = Number(
                    data.total_count
                );
            }

            pageCache.set(
                String(data.page || page),
                data
            );

            renderScenes(
                data,
                true
            );
        } catch (error) {
            stop();
            console.error(error);
            renderError(error);
        }
    }

    async function startBrowseContext(context) {
        const newKey = browseContextKey(
            context
        );

        const oldKey = browseContextKey(
            currentBrowseContext
        );

        if (newKey !== oldKey) {
            currentBrowseContext = context;

            if (context.type === "performer") {
                currentPerformerName =
                    context.value;
            } else {
                currentPerformerName = null;
            }

            restoreSelections(
                newKey
            );

            sceneCache.clear();
            pageCache.clear();
            importedSceneStatus.clear();
            importedImageStatus.clear();

            viewHistory.splice(0);
            viewHistoryIndex = -1;
            lastSearchData = null;
            currentSceneData = null;
            currentPreflight = null;
            knownTotalCount = null;
            sceneImportFilter = "all";
            paginationSeed =
                makeRequestId();

            if (
                context.source === "global" &&
                lastGlobalSearchState
            ) {
                recordView({
                    type: "global_search",
                    query:
                        lastGlobalSearchState.query,
                    searchType:
                        lastGlobalSearchState.searchType,
                    results:
                        lastGlobalSearchState.results
                });
            }
        }

        currentBrowseContext = context;

        if (!paginationSeed) {
            paginationSeed =
                makeRequestId();
        }

        await loadPerformerPage(1);
    }

    async function startPerformerSearch(performer) {
        await startBrowseContext({
            type: "performer",
            value: performer,
            label: performer,
            url: "",
            source: "performer_tab"
        });
    }

    function globalSearchTypeButton(
        value,
        label,
        current
    ) {
        let activeClass = "";

        if (value === current) {
            activeClass = " ppics-global-type-active";
        }

        return `
            <button
                type="button"
                class="ppics-global-type${activeClass}"
                data-search-type="${escapeHtml(value)}"
            >
                ${escapeHtml(label)}
            </button>
        `;
    }

    function looksLikePornPicsUrl(value) {
        value = String(
            value || ""
        ).trim();

        if (!value) {
            return false;
        }

        let candidate = value;
        const lowered =
            candidate.toLowerCase();

        if (
            lowered.indexOf(
                "pornpics.com/"
            ) === 0
            || lowered.indexOf(
                "www.pornpics.com/"
            ) === 0
        ) {
            candidate =
                "https://"
                + candidate;
        }

        try {
            const parsed =
                new URL(
                    candidate
                );

            const host =
                String(
                    parsed.hostname || ""
                ).toLowerCase();

            return (
                (
                    parsed.protocol ===
                    "https:"
                    || parsed.protocol ===
                    "http:"
                )
                && (
                    host ===
                    "pornpics.com"
                    || host ===
                    "www.pornpics.com"
                )
            );
        } catch (error) {
            return false;
        }
    }

    async function openDirectPornPicsScene(
        scene
    ) {
        const context = {
            type: "scene",
            value: "PornPics",
            label: "Direct PornPics scene",
            url: scene.url,
            source: "global"
        };

        currentBrowseContext =
            context;

        currentPerformerName =
            null;

        restoreSelections(
            browseContextKey(
                context
            )
        );

        sceneCache.clear();
        pageCache.clear();
        importedSceneStatus.clear();
        importedImageStatus.clear();

        viewHistory.splice(0);
        viewHistoryIndex = -1;
        lastSearchData = null;
        currentSceneData = null;
        currentPreflight = null;
        knownTotalCount = null;
        sceneImportFilter = "all";
        paginationSeed =
            makeRequestId();

        const searchState =
            restoreGlobalSearchState();

        if (searchState) {
            recordView({
                type: "global_search",
                query:
                    searchState.query,
                searchType:
                    searchState.searchType,
                results:
                    searchState.results
            });
        }

        await openScene(
            scene
        );
    }

    async function openGlobalUrlTarget(
        target
    ) {
        if (
            !target
            || !target.kind
        ) {
            throw new Error(
                "PornPics returned an invalid URL target."
            );
        }

        if (
            target.kind ===
            "scene"
        ) {
            await openDirectPornPicsScene(
                target.scene
            );

            return;
        }

        if (
            target.kind ===
            "context"
        ) {
            const context =
                Object.assign(
                    {},
                    target.context || {}
                );

            context.source =
                "global";

            await startBrowseContext(
                context
            );

            return;
        }

        throw new Error(
            "This PornPics URL type is not supported."
        );
    }

    function globalResultGroupLabel(type) {
        if (type === "performer") {
            return "Performers";
        }

        if (type === "studio") {
            return "Studios";
        }

        if (type === "tag") {
            return "Tags";
        }

        if (type === "keyword") {
            return "Scene search";
        }

        return "Results";
    }

    function globalResultTypeLabel(type) {
        if (type === "performer") {
            return "Performer";
        }

        if (type === "studio") {
            return "Studio";
        }

        if (type === "tag") {
            return "Tag";
        }

        if (type === "keyword") {
            return "Scenes";
        }

        return type;
    }

    function globalResultPlaceholder(item) {
        if (item.type === "performer") {
            return "P";
        }

        if (item.type === "studio") {
            return "S";
        }

        if (item.type === "tag") {
            return "T";
        }

        return "⌕";
    }

    function globalResultCard(item) {
        let countHtml = "";

        if (item.scene_count_hint) {
            countHtml = `
                <span>
                    ${escapeHtml(item.scene_count_hint)} galleries
                </span>
            `;
        } else if (item.preview_count) {
            countHtml = `
                <span>
                    ${escapeHtml(item.preview_count)} preview results
                </span>
            `;
        }

        let imageHtml = `
            <div
                class="ppics-global-result-placeholder"
                data-result-type="${escapeHtml(item.type)}"
            >
                ${escapeHtml(globalResultPlaceholder(item))}
            </div>
        `;

        if (item.thumbnail) {
            imageHtml = `
                <img
                    src="${escapeHtml(item.thumbnail)}"
                    alt=""
                    loading="lazy"
                >
            `;
        }

        let title = item.label;

        if (item.type === "keyword") {
            title =
                'Search scenes for "' +
                item.label +
                '"';
        }

        return `
            <button
                type="button"
                class="ppics-global-result-card"
                data-context-type="${escapeHtml(item.type)}"
                data-context-value="${escapeHtml(item.value)}"
                data-context-label="${escapeHtml(item.label)}"
                data-context-url="${escapeHtml(item.url)}"
            >
                <div class="ppics-global-result-image">
                    ${imageHtml}
                </div>

                <div class="ppics-global-result-copy">
                    <span class="ppics-global-result-type">
                        ${escapeHtml(globalResultTypeLabel(item.type))}
                    </span>

                    <strong>
                        ${escapeHtml(title)}
                    </strong>

                    <div class="ppics-global-result-meta">
                        ${countHtml}
                        <span>Browse photos →</span>
                    </div>
                </div>
            </button>
        `;
    }

    function globalResultsHtml(
        query,
        results,
        state
    ) {
        query = String(
            query || ""
        );

        results = Array.from(
            results || []
        );

        if (state === "opening_url") {
            return `
                <div class="ppics-global-searching">
                    <span class="spinner-border spinner-border-sm"></span>
                    <div>
                        <strong>Opening PornPics URL</strong>
                        <span>Checking the link and loading its gallery data</span>
                    </div>
                </div>
            `;
        }

        if (state === "loading") {
            return `
                <div class="ppics-global-searching">
                    <span class="spinner-border spinner-border-sm"></span>
                    <div>
                        <strong>Searching PornPics</strong>
                        <span>Finding matching performers, studios, tags and scenes</span>
                    </div>
                </div>
            `;
        }

        if (state === "error") {
            return `
                <div class="ppics-global-inline-error">
                    <strong>Search could not be completed</strong>
                    <span>
                        PornPics or Stash did not return the expected search data.
                        Try again in a moment.
                    </span>
                </div>
            `;
        }

        if (
            query
            && query.length < 2
        ) {
            return `
                <div class="ppics-global-welcome ppics-global-small-state">
                    <div class="ppics-global-welcome-icon">⌕</div>
                    <h3>Keep typing</h3>
                    <p>
                        Enter at least 2 characters to search PornPics.
                    </p>
                </div>
            `;
        }

        if (
            query
            && !results.length
        ) {
            return `
                <div class="ppics-global-empty">
                    <div class="ppics-empty-icon">⌕</div>
                    <h3>No PornPics matches found</h3>
                    <p>
                        Try a shorter name, a different spelling,
                        or switch between performers, studios and tags.
                    </p>
                </div>
            `;
        }

        if (!query) {
            return `
                <div class="ppics-global-welcome">
                    <div class="ppics-global-welcome-icon">⌕</div>
                    <h3>Search the PornPics library</h3>
                    <p>
                        Start typing a performer, studio or tag.
                        Matching PornPics entries appear automatically.
                    </p>
                </div>
            `;
        }

        const order = [
            "keyword",
            "performer",
            "studio",
            "tag"
        ];

        let html = "";

        order.forEach(function (type) {
            const group =
                results.filter(
                    function (item) {
                        return item.type === type;
                    }
                );

            if (!group.length) {
                return;
            }

            let cards = "";

            group.forEach(function (item) {
                cards += globalResultCard(
                    item
                );
            });

            html += `
                <section class="ppics-global-result-group">
                    <div class="ppics-global-result-group-head">
                        <h3>
                            ${escapeHtml(globalResultGroupLabel(type))}
                        </h3>
                        <span>
                            ${escapeHtml(group.length)}
                        </span>
                    </div>

                    <div class="ppics-global-result-grid">
                        ${cards}
                    </div>
                </section>
            `;
        });

        return html;
    }

    function bindGlobalResultCards() {
        document.querySelectorAll(
            ".ppics-global-result-card"
        ).forEach(function (card) {
            card.addEventListener(
                "click",
                function () {
                    startBrowseContext({
                        type:
                            card.dataset.contextType,
                        value:
                            card.dataset.contextValue,
                        label:
                            card.dataset.contextLabel,
                        url:
                            card.dataset.contextUrl,
                        source:
                            "global"
                    });
                }
            );
        });
    }

    function updateGlobalResultsArea(
        query,
        results,
        state
    ) {
        const container =
            document.querySelector(
                ".ppics-global-results"
            );

        if (!container) {
            return;
        }

        container.innerHTML =
            globalResultsHtml(
                query,
                results,
                state
            );

        bindGlobalResultCards();
    }

    function renderGlobalSearchPage(
        query,
        searchType,
        results,
        addHistory
    ) {
        ppicsActive = true;
        globalRouteActive = true;

        query = String(
            query || ""
        );

        searchType = String(
            searchType || "all"
        );

        results = Array.from(
            results || []
        );

        lastGlobalSearchState = {
            query: query,
            searchType: searchType,
            results: results
        };

        saveGlobalSearchState();

        setContent(`
            <div class="ppics-browser ppics-global-browser p-3">
                <div class="ppics-global-hero">
                    <div class="ppics-eyebrow">
                        PornPics Importer
                    </div>

                    <h2>Search PornPics</h2>

                    <div class="ppics-hero-subtitle">
                        Search by performer, studio or tag, or paste a PornPics URL.
                    </div>
                </div>

                <form class="ppics-global-search-form">
                    <div class="ppics-global-search-row">
                        <div class="ppics-global-input-shell">
                            <span class="ppics-global-search-icon">
                                ⌕
                            </span>

                            <input
                                type="search"
                                class="form-control ppics-global-search-input"
                                value="${escapeHtml(query)}"
                                placeholder="Search performer, studio, tag, or paste a PornPics URL"
                                autocomplete="off"
                                spellcheck="false"
                            >
                        </div>

                        <button
                            type="submit"
                            class="btn btn-primary ppics-global-search-submit"
                        >
                            Search
                        </button>
                    </div>

                    <div class="ppics-global-types">
                        ${globalSearchTypeButton("all", "All", searchType)}
                        ${globalSearchTypeButton("performer", "Performers", searchType)}
                        ${globalSearchTypeButton("studio", "Studios", searchType)}
                        ${globalSearchTypeButton("tag", "Tags", searchType)}
                    </div>

                    <div class="ppics-global-url-hint">
                        Tip: paste a PornPics gallery, performer, studio, tag, or category URL to open it directly.
                    </div>
                </form>

                <div class="ppics-global-results">
                    ${globalResultsHtml(query, results, "")}
                </div>
            </div>
        `);

        const form =
            document.querySelector(
                ".ppics-global-search-form"
            );

        const input =
            document.querySelector(
                ".ppics-global-search-input"
            );

        let selectedType =
            searchType;

        document.querySelectorAll(
            ".ppics-global-type"
        ).forEach(function (button) {
            button.addEventListener(
                "click",
                function () {
                    selectedType =
                        button.dataset.searchType;

                    document.querySelectorAll(
                        ".ppics-global-type"
                    ).forEach(function (item) {
                        item.classList.remove(
                            "ppics-global-type-active"
                        );
                    });

                    button.classList.add(
                        "ppics-global-type-active"
                    );

                    const value = String(
                        input.value || ""
                    ).trim();

                    if (value.length >= 2) {
                        runGlobalSearch(
                            value,
                            selectedType,
                            true
                        );
                    }
                }
            );
        });

        if (input) {
            input.addEventListener(
                "input",
                function () {
                    const value = String(
                        input.value || ""
                    ).trim();

                    if (globalSearchTimer) {
                        window.clearTimeout(
                            globalSearchTimer
                        );
                    }

                    if (!value) {
                        globalSearchSequence += 1;

                        lastGlobalSearchState = {
                            query: "",
                            searchType:
                                selectedType,
                            results: []
                        };

                        saveGlobalSearchState();

                        updateGlobalResultsArea(
                            "",
                            [],
                            ""
                        );

                        return;
                    }

                    if (value.length < 2) {
                        globalSearchSequence += 1;

                        updateGlobalResultsArea(
                            value,
                            [],
                            ""
                        );

                        return;
                    }

                    let loadingState =
                        "loading";

                    let searchDelay =
                        550;

                    if (
                        looksLikePornPicsUrl(
                            value
                        )
                    ) {
                        loadingState =
                            "opening_url";

                        searchDelay =
                            100;
                    }

                    updateGlobalResultsArea(
                        value,
                        [],
                        loadingState
                    );

                    globalSearchTimer =
                        window.setTimeout(
                            function () {
                                runGlobalSearch(
                                    value,
                                    selectedType,
                                    true
                                );
                            },
                            searchDelay
                        );
                }
            );
        }

        if (form) {
            form.addEventListener(
                "submit",
                function (event) {
                    event.preventDefault();

                    const value = String(
                        input.value || ""
                    ).trim();

                    if (
                        value.length < 2
                    ) {
                        input.focus();

                        updateGlobalResultsArea(
                            value,
                            [],
                            ""
                        );

                        return;
                    }

                    if (globalSearchTimer) {
                        window.clearTimeout(
                            globalSearchTimer
                        );
                    }

                    runGlobalSearch(
                        value,
                        selectedType,
                        false
                    );
                }
            );
        }

        bindGlobalResultCards();

        if (input && !query) {
            window.setTimeout(
                function () {
                    input.focus();
                },
                50
            );
        }

        if (addHistory !== false) {
            recordView({
                type: "global_search",
                query: query,
                searchType: searchType,
                results: results
            });
        }
    }

    async function runGlobalSearch(
        query,
        searchType,
        live
    ) {
        query = String(
            query || ""
        ).trim();

        searchType = String(
            searchType || "all"
        );

        if (query.length < 2) {
            return;
        }

        globalSearchSequence += 1;

        const sequence =
            globalSearchSequence;

        let loadingState =
            "loading";

        if (
            looksLikePornPicsUrl(
                query
            )
        ) {
            loadingState =
                "opening_url";
        }

        updateGlobalResultsArea(
            query,
            [],
            loadingState
        );

        try {
            const data = await requestData(
                {
                    mode:
                        "global_context_search",
                    query:
                        query,
                    search_type:
                        searchType
                },
                null,
                90000
            );

            if (
                sequence !==
                globalSearchSequence
            ) {
                return;
            }

            if (data.direct_target) {
                lastGlobalSearchState = {
                    query: query,
                    searchType:
                        searchType,
                    results: []
                };

                saveGlobalSearchState();

                await openGlobalUrlTarget(
                    data.direct_target
                );

                return;
            }

            const results =
                data.results || [];

            lastGlobalSearchState = {
                query: query,
                searchType:
                    searchType,
                results:
                    results
            };

            saveGlobalSearchState();

            updateGlobalResultsArea(
                query,
                results,
                ""
            );

            if (!live) {
                recordView({
                    type:
                        "global_search",
                    query:
                        query,
                    searchType:
                        searchType,
                    results:
                        results
                });
            }

        } catch (error) {
            if (
                sequence !==
                globalSearchSequence
            ) {
                return;
            }

            console.error(
                "PornPics search failed",
                error
            );

            if (
                looksLikePornPicsUrl(
                    query
                )
            ) {
                showGlobalError(
                    error
                );

                return;
            }

            updateGlobalResultsArea(
                query,
                [],
                "error"
            );
        }
    }

    function registerGlobalPornPicsRoute() {
        if (globalRouteRegistered) {
            return true;
        }

        if (
            !window.PluginApi ||
            !window.PluginApi.register ||
            !window.PluginApi.register.route ||
            !window.PluginApi.React
        ) {
            return false;
        }

        const React = window.PluginApi.React;

        function PornPicsGlobalRoute() {
            React.useEffect(
                function () {
                    globalRouteActive = true;
                    ppicsActive = true;

                    maskGlobalPornPicsUrl();

                    window.setTimeout(
                        function () {
                            const state =
                                restoreGlobalSearchState();

                            if (state) {
                                renderGlobalSearchPage(
                                    state.query,
                                    state.searchType,
                                    state.results,
                                    true
                                );
                            } else {
                                renderGlobalSearchPage(
                                    "",
                                    "all",
                                    [],
                                    true
                                );
                            }
                        },
                        0
                    );

                    return function () {
                        globalRouteActive = false;

                        if (
                            !window.location.pathname.startsWith(
                                "/performers/"
                            )
                        ) {
                            ppicsActive = false;
                        }
                    };
                },
                []
            );

            return React.createElement(
                "div",
                {
                    id: "ppics-global-root",
                    className: "ppics-global-root"
                }
            );
        }

        window.PluginApi.register.route(
            "/plugin/pornpics",
            PornPicsGlobalRoute
        );

        globalRouteRegistered = true;
        return true;
    }

    function navigateToGlobalPornPics() {
        const routeReady =
            registerGlobalPornPicsRoute();

        if (!routeReady) {
            showGlobalError(
                new Error(
                    "Stash UI routing is not ready yet. Reload the page and try PornPics again."
                )
            );

            return;
        }

        if (isRegisteredGlobalPornPicsPath()) {
            globalRouteActive = true;
            ppicsActive = true;

            const state =
                restoreGlobalSearchState();

            window.setTimeout(
                function () {
                    if (state) {
                        renderGlobalSearchPage(
                            state.query,
                            state.searchType,
                            state.results,
                            true
                        );
                    } else {
                        renderGlobalSearchPage(
                            "",
                            "all",
                            [],
                            true
                        );
                    }
                },
                0
            );

            return;
        }

        window.history.pushState(
            {},
            "",
            GLOBAL_ROUTE_PATH
        );

        window.dispatchEvent(
            new PopStateEvent(
                "popstate",
                {
                    state:
                        window.history.state
                }
            )
        );
    }

    function navAnchorPath(anchor) {
        if (!anchor) {
            return "";
        }

        try {
            const parsed =
                new URL(
                    anchor.href,
                    window.location.origin
                );

            return parsed.pathname || "";
        } catch (error) {
            const href =
                String(
                    anchor.getAttribute("href")
                    || ""
                );

            const hashIndex =
                href.indexOf("#");

            let cleanHref =
                href;

            if (hashIndex >= 0) {
                cleanHref =
                    href.slice(
                        0,
                        hashIndex
                    );
            }

            const queryMarker =
                String.fromCharCode(63);

            const queryIndex =
                cleanHref.indexOf(
                    queryMarker
                );

            if (queryIndex >= 0) {
                cleanHref =
                    cleanHref.slice(
                        0,
                        queryIndex
                    );
            }

            return cleanHref;
        }
    }

    function isVisibleNavAnchor(anchor) {
        if (!anchor) {
            return false;
        }

        const style =
            window.getComputedStyle(
                anchor
            );

        if (
            style.display === "none"
            || style.visibility === "hidden"
        ) {
            return false;
        }

        const rect =
            anchor.getBoundingClientRect();

        if (
            rect.width <= 0
            || rect.height <= 0
        ) {
            return false;
        }

        return true;
    }

    function findGlobalNavTarget() {
        const wantedPaths = [
            "/images",
            "/performers",
            "/scenes",
            "/galleries",
            "/studios"
        ];

        const anchors =
            Array.from(
                document.querySelectorAll(
                    "a[href]"
                )
            );

        let fallback = null;

        for (
            let pathIndex = 0;
            pathIndex < wantedPaths.length;
            pathIndex += 1
        ) {
            const wantedPath =
                wantedPaths[
                    pathIndex
                ];

            for (
                let anchorIndex = 0;
                anchorIndex < anchors.length;
                anchorIndex += 1
            ) {
                const anchor =
                    anchors[
                        anchorIndex
                    ];

                if (
                    navAnchorPath(
                        anchor
                    ) !== wantedPath
                ) {
                    continue;
                }

                const nav =
                    anchor.closest(
                        "nav"
                    );

                const navbar =
                    anchor.closest(
                        ".navbar"
                    );

                const navbarNav =
                    anchor.closest(
                        ".navbar-nav"
                    );

                if (
                    isVisibleNavAnchor(
                        anchor
                    )
                    && (
                        nav
                        || navbar
                        || navbarNav
                    )
                ) {
                    return anchor;
                }

                if (
                    !fallback
                    && (
                        nav
                        || navbar
                        || navbarNav
                    )
                ) {
                    fallback =
                        anchor;
                }
            }
        }

        return fallback;
    }

    function nativeNavWrapperFor(
        target
    ) {
        if (!target) {
            return null;
        }

        const rbWrapper =
            target.closest(
                "[data-rb-event-key]"
            );

        if (rbWrapper) {
            return rbWrapper;
        }

        const navLinkWrapper =
            target.closest(
                ".nav-link"
            );

        if (
            navLinkWrapper
            && navLinkWrapper !== target
        ) {
            return navLinkWrapper;
        }

        return target.parentElement;
    }

    function prepareNativePornPicsLink(
        link
    ) {
        if (!link) {
            return null;
        }

        link.id =
            "ppics-main-nav-link";

        link.href =
            GLOBAL_SAFE_URL;

        link.setAttribute(
            "aria-label",
            "Open PornPics"
        );

        link.removeAttribute(
            "aria-current"
        );

        link.classList.remove(
            "active"
        );

        const text =
            link.querySelector(
                "span"
            );

        if (text) {
            text.textContent =
                "PornPics";
        } else {
            const label =
                document.createElement(
                    "span"
                );

            label.textContent =
                "PornPics";

            link.appendChild(
                label
            );
        }

        link.addEventListener(
            "click",
            function (event) {
                event.preventDefault();
                event.stopPropagation();

                navigateToGlobalPornPics();
            }
        );

        return link;
    }

    function makeGlobalNavItem(
        target
    ) {
        const sourceWrapper =
            nativeNavWrapperFor(
                target
            );

        if (!sourceWrapper) {
            return null;
        }

        const wrapper =
            sourceWrapper.cloneNode(
                true
            );

        wrapper.removeAttribute(
            "id"
        );

        if (
            wrapper.hasAttribute(
                "data-rb-event-key"
            )
        ) {
            wrapper.setAttribute(
                "data-rb-event-key",
                GLOBAL_SAFE_URL
            );
        }

        wrapper.classList.remove(
            "active"
        );

        let link = null;

        if (
            wrapper.matches(
                "a[href]"
            )
        ) {
            link =
                wrapper;
        } else {
            link =
                wrapper.querySelector(
                    "a[href]"
                );
        }

        if (!link) {
            return null;
        }

        prepareNativePornPicsLink(
            link
        );

        wrapper.setAttribute(
            "data-ppics-native-nav-item",
            "1"
        );

        return {
            wrapper: wrapper,
            link: link,
            sourceWrapper: sourceWrapper
        };
    }

    function injectGlobalNavLink() {
        const existing =
            document.getElementById(
                "ppics-main-nav-link"
            );

        if (
            existing
            && existing.isConnected
        ) {
            return true;
        }

        const target =
            findGlobalNavTarget();

        if (!target) {
            return false;
        }

        const item =
            makeGlobalNavItem(
                target
            );

        if (
            !item
            || !item.wrapper
            || !item.sourceWrapper
        ) {
            return false;
        }

        item.sourceWrapper.insertAdjacentElement(
            "afterend",
            item.wrapper
        );

        return true;
    }

    function startGlobalNavObserver() {
        if (
            window.ppicsGlobalNavObserver
        ) {
            return;
        }

        const root =
            document.body
            || document.documentElement;

        if (!root) {
            return;
        }

        const observer =
            new MutationObserver(
                function () {
                    injectGlobalNavLink();
                }
            );

        observer.observe(
            root,
            {
                childList: true,
                subtree: true
            }
        );

        window.ppicsGlobalNavObserver =
            observer;
    }

    function enhanceGenderSetting() {
        if (!window.location.pathname.includes("settings")) {
            return;
        }

        const labels = Array.from(document.querySelectorAll("label"));
        let targetLabel = null;

        labels.forEach(function (label) {
            if (
                label.textContent &&
                label.textContent.trim() === "Performer display mode"
            ) {
                targetLabel = label;
            }
        });

        if (!targetLabel) {
            return;
        }

        let container = targetLabel.parentElement;

        for (let depth = 0; depth < 4 && container; depth += 1) {
            const input = container.querySelector("input");

            if (input) {
                if (input.dataset.ppicsEnhanced === "1") {
                    return;
                }

                input.dataset.ppicsEnhanced = "1";
                input.setAttribute("list", "ppics-gender-mode-options");
                input.setAttribute("placeholder", "Female only");

                let datalist = document.getElementById(
                    "ppics-gender-mode-options"
                );

                if (!datalist) {
                    datalist = document.createElement("datalist");
                    datalist.id = "ppics-gender-mode-options";
                    datalist.innerHTML = `
                        <option value="Female only"></option>
                        <option value="Male only"></option>
                        <option value="Female and male - female first"></option>
                    `;
                    document.body.appendChild(datalist);
                }

                return;
            }

            container = container.parentElement;
        }
    }

    let masonryResizeTimer = null;

    window.addEventListener(
        "resize",
        function () {
            if (masonryResizeTimer) {
                window.clearTimeout(
                    masonryResizeTimer
                );
            }

            masonryResizeTimer = window.setTimeout(
                refreshMasonryLayout,
                120
            );
        }
    );

    function inject() {
        enhanceGenderSetting();
        registerGlobalPornPicsRoute();
        startGlobalNavObserver();
        injectGlobalNavLink();

        if (isGlobalPornPicsSafeUrl()) {
            navigateToGlobalPornPics();
            return;
        }

        if (isRegisteredGlobalPornPicsPath()) {
            ppicsActive = true;
            globalRouteActive = true;
            return;
        }

        if (!window.location.pathname.startsWith("/performers/")) {
            globalRouteActive = false;
            deactivatePornPicsView();
            return;
        }

        ensurePornPicsMount();

        if (document.getElementById("performer-tabs-tab-ppics")) {
            return;
        }

        const tabs = performerTabsNav();

        if (!tabs) {
            return;
        }

        const tab = document.createElement("a");
        tab.id = "performer-tabs-tab-ppics";
        tab.href = "#";
        tab.className = "nav-item nav-link";
        tab.innerText = "PornPics";

        tab.addEventListener("click", async function (event) {
            event.preventDefault();
            activatePornPicsView();

            document.querySelectorAll("nav.nav-tabs .nav-link")
                .forEach(function (item) {
                    item.classList.remove("active");
                });

            tab.classList.add("active");

            const performer = currentPerformer();

            if (!performer) {
                renderError("Could not determine performer.");
                return;
            }

            await startPerformerSearch(performer);
        });

        const imagesTab = document.getElementById(
            "performer-tabs-tab-images"
        );

        if (imagesTab) {
            imagesTab.insertAdjacentElement("afterend", tab);
        } else {
            tabs.appendChild(tab);
        }
    }

    registerGlobalPornPicsRoute();
    startGlobalNavObserver();
    injectGlobalNavLink();
    setInterval(inject, 500);
})();
