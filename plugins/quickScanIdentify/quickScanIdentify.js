(function () {
  "use strict";

  const PLUGIN_ID = "quickScanIdentify";
  const TASKS = [
    {
      id: "qsi-nav-directory-a",
      label: "Scan & Identify A",
      taskName: "Scan and Identify Directory A"
    },
    {
      id: "qsi-nav-directory-b",
      label: "Scan & Identify B",
      taskName: "Scan and Identify Directory B"
    },
    {
      id: "qsi-nav-tag-refresh",
      label: "Tag & Refresh",
      icon: "🏷️",
      steps: [
        { pluginId: "performerTagger", taskName: "Batch Tag Performers (Missing Only)" },
        { pluginId: "restash", taskName: "Quick Refresh" }
      ]
    }
  ];

  async function runStep(pluginId, taskName) {
    const query = `
      mutation RunQuickScanIdentify(
        $plugin_id: ID!,
        $task_name: String!
      ) {
        runPluginTask(
          plugin_id: $plugin_id,
          task_name: $task_name
        )
      }
    `;
    const response = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        query: query,
        variables: {
          plugin_id: pluginId,
          task_name: taskName
        }
      })
    });

    if (!response.ok) {
      throw new Error("Stash returned HTTP " + response.status + ".");
    }

    const result = await response.json();
    if (result.errors && result.errors.length) {
      throw new Error(result.errors.map(function (error) {
        return error.message;
      }).join(", "));
    }
    if (!result.data || !result.data.runPluginTask) {
      throw new Error("Stash did not queue the task.");
    }
  }

  async function runTask(task) {
    const steps = task.steps || [{ pluginId: PLUGIN_ID, taskName: task.taskName }];
    // Stash runs queued plugin tasks serially, so queue order is execution order.
    for (const step of steps) {
      await runStep(step.pluginId, step.taskName);
    }
  }

  function addNavbarButtons() {
    const navTarget = document.querySelector(".navbar-nav");
    if (!navTarget) {
      return;
    }

    TASKS.forEach(function (task) {
      if (document.getElementById(task.id)) {
        return;
      }

      const container = document.createElement("div");
      container.className = "col-4 col-sm-3 col-md-2 col-lg-auto nav-link";
      container.innerHTML = `
        <a href="javascript:void(0);" id="${task.id}"
          class="minimal p-4 p-xl-2 d-flex d-xl-inline-block flex-column justify-content-between align-items-center"
          title="${task.label}">
          <span class="d-block d-xl-inline mb-2 mb-xl-0" aria-hidden="true">${task.icon || "📁"}</span>
          <span>${task.label}</span>
        </a>
      `;

      const link = container.querySelector("a");
      link.addEventListener("click", async function (event) {
        event.preventDefault();
        if (link.dataset.running === "true") {
          return;
        }
        link.dataset.running = "true";
        link.setAttribute("aria-disabled", "true");
        link.style.opacity = "0.6";
        try {
          await runTask(task);
        } catch (error) {
          console.error("[QuickScanIdentify] Failed to queue task:", error);
        } finally {
          delete link.dataset.running;
          link.removeAttribute("aria-disabled");
          link.style.opacity = "";
        }
      });

      navTarget.appendChild(container);
    });
  }

  function initialize() {
    addNavbarButtons();
    const observer = new MutationObserver(addNavbarButtons);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
