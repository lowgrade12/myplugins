(function() {
    'use strict';

    const {
        stash,
        Stash,
        waitForElementId,
        waitForElementClass,
        waitForElementByXpath,
        getElementByXpath,
        getClosestAncestor,
        updateTextInput,
    } = window.stash7dJx1qP;

    async function runSetStashBoxFavoritePerformersTask() {
        const data = await stash.getStashBoxes();
        if (!data.data.configuration.general.stashBoxes.length) {
            alert('No Stashbox configured.');
        }
        for (const { endpoint, api_key } of data.data.configuration.general.stashBoxes) {
            if (endpoint !== 'https://stashdb.org/graphql') continue;
            await stash.runPluginTask("stashSetStashboxFavoritePerformers", "Set Stashbox Favorite Performers", [{"key":"endpoint", "value":{"str": endpoint}}, {"key":"api_key", "value":{"str": api_key}}]);
        }
    }

    async function runSetStashBoxFavoritePerformerTask(endpoint, api_key, stashId, favorite) {
        if (endpoint !== 'https://stashdb.org/graphql') return;
        return stash.runPluginTask("stashSetStashboxFavoritePerformers", "Set Stashbox Favorite Performer", [{"key":"endpoint", "value":{"str": endpoint}}, {"key":"api_key", "value":{"str": api_key}}, {"key":"stash_id", "value":{"str": stashId}}, {"key":"favorite", "value":{"b": favorite}}]);
    }

    async function runSetStashBoxFavoriteStudiosTask() {
        const data = await stash.getStashBoxes();
        if (!data.data.configuration.general.stashBoxes.length) {
            alert('No Stashbox configured.');
        }
        for (const { endpoint, api_key } of data.data.configuration.general.stashBoxes) {
            if (endpoint !== 'https://stashdb.org/graphql') continue;
            await stash.runPluginTask("stashSetStashboxFavoritePerformers", "Set Stashbox Favorite Studios", [{"key":"endpoint", "value":{"str": endpoint}}, {"key":"api_key", "value":{"str": api_key}}]);
        }
    }

    async function runSetStashBoxFavoriteStudioTask(endpoint, api_key, stashId, favorite) {
        if (endpoint !== 'https://stashdb.org/graphql') return;
        return stash.runPluginTask("stashSetStashboxFavoritePerformers", "Set Stashbox Favorite Studio", [{"key":"endpoint", "value":{"str": endpoint}}, {"key":"api_key", "value":{"str": api_key}}, {"key":"stash_id", "value":{"str": stashId}}, {"key":"favorite", "value":{"b": favorite}}]);
    }

    stash.addEventListener('page:performers', function () {
        waitForElementClass("btn-toolbar", async function () {
            if (!document.getElementById('stashbox-favorite-task')) {
                const settings = await stash.getPluginConfig('stashSetStashboxFavoritePerformers');

                const toolbar = document.querySelector(".btn-toolbar");

                const newGroup = document.createElement('div');
                newGroup.classList.add('mx-2', 'mb-2', settings?.performerPageButton ? 'd-flex' : 'd-none');
                toolbar.appendChild(newGroup);

                const button = document.createElement("button");
                button.setAttribute("id", "stashbox-favorite-task");
                button.classList.add('btn', 'btn-secondary');
                button.innerHTML = 'Set Stashbox Favorites';
                button.onclick = () => {
                    runSetStashBoxFavoritePerformersTask();
                };
                newGroup.appendChild(button);
            }
        });
    });

    stash.addEventListener('page:studios', function () {
        waitForElementClass("btn-toolbar", async function () {
            if (!document.getElementById('stashbox-studio-favorite-task')) {
                const settings = await stash.getPluginConfig('stashSetStashboxFavoritePerformers');

                const toolbar = document.querySelector(".btn-toolbar");

                const newGroup = document.createElement('div');
                newGroup.classList.add('mx-2', 'mb-2', settings?.studioPageButton ? 'd-flex' : 'd-none');
                toolbar.appendChild(newGroup);

                const button = document.createElement("button");
                button.setAttribute("id", "stashbox-studio-favorite-task");
                button.classList.add('btn', 'btn-secondary');
                button.innerHTML = 'Set Stashbox Favorites';
                button.onclick = () => {
                    runSetStashBoxFavoriteStudiosTask();
                };
                newGroup.appendChild(button);
            }
        });
    });

    stash.addEventListener('stash:response', async function (evt) {
        const data = evt.detail;
        let performers;
        let studios;
        if (data.data?.performerUpdate?.stash_ids?.length) {
            performers = [data.data.performerUpdate];
        }
        else if (data.data?.bulkPerformerUpdate) {
            performers = data.data.bulkPerformerUpdate.filter(performer => performer?.stash_ids?.length);
        }
        if (data.data?.studioUpdate?.stash_ids?.length) {
            studios = [data.data.studioUpdate];
        }
        else if (data.data?.bulkStudioUpdate) {
            studios = data.data.bulkStudioUpdate.filter(studio => studio?.stash_ids?.length);
        }
        if (performers) {
            if (performers.length <= 10) {
                const data = await stash.getStashBoxes();
                for (const performer of performers) {
                    for (const { endpoint, stash_id } of performer.stash_ids) {
                        const api_key = data.data.configuration.general.stashBoxes.find(o => o.endpoint === endpoint)?.api_key;
                        if (api_key) {
                            runSetStashBoxFavoritePerformerTask(endpoint, api_key, stash_id, performer.favorite);
                        }
                    }
                }
            }
            else {
                runSetStashBoxFavoritePerformersTask();
            }
        }
        if (studios) {
            if (studios.length <= 10) {
                const stashBoxData = await stash.getStashBoxes();
                for (const studio of studios) {
                    for (const { endpoint, stash_id } of studio.stash_ids) {
                        const api_key = stashBoxData.data.configuration.general.stashBoxes.find(o => o.endpoint === endpoint)?.api_key;
                        if (api_key) {
                            runSetStashBoxFavoriteStudioTask(endpoint, api_key, stash_id, studio.favorite);
                        }
                    }
                }
            }
            else {
                runSetStashBoxFavoriteStudiosTask();
            }
        }
    });

    stash.addEventListener('stash:plugin:task', async function (evt) {
        const { taskName, task } = evt.detail;
        if (taskName === 'Set Stashbox Favorite Performers') {
            const taskButton = task.querySelector('button');
            if (!taskButton.classList.contains('hooked')) {
                taskButton.classList.add('hooked');
                taskButton.addEventListener('click', evt => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    runSetStashBoxFavoritePerformersTask();
                });
            }
        }
        if (taskName === 'Set Stashbox Favorite Studios') {
            const taskButton = task.querySelector('button');
            if (!taskButton.classList.contains('hooked')) {
                taskButton.classList.add('hooked');
                taskButton.addEventListener('click', evt => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    runSetStashBoxFavoriteStudiosTask();
                });
            }
        }
    });

    stash.registerHiddenPluginTask('Stash Set Stashbox Favorite Performers', 'Set Stashbox Favorite Performer');
    stash.registerHiddenPluginTask('Stash Set Stashbox Favorite Performers', 'Set Stashbox Favorite Studio');

})();
