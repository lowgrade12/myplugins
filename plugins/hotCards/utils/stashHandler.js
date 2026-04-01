(function () {
  "use strict";

  const _hc = window._hotCards = window._hotCards || {};

  const stash = {
    galleries: {},
    images: {},
    groups: {},
    performers: {},
    scenes: {},
    studios: {},
  };

  // Export stash for other hotCards files
  _hc.stash = stash;

  const dataProcessors = {
    galleries: processData("findGalleries", "galleries"),
    images: processData("findImages", "images"),
    groups: processData("findGroups", "groups"),
    performers: processData("findPerformers", "performers"),
    scenes: processData("findScenes", "scenes"),
    studios: processData("findStudios", "studios"),
  };

  window.stashListener.addEventListener("response", (event) => {
    for (const key in dataProcessors) {
      dataProcessors[key](event.detail);
    }

    processOtherData(event.detail);
  });

  function processData(findKey, dataKey) {
    return function (data) {
      if (data?.data?.[findKey]?.[dataKey]) {
        for (const item of data.data[findKey][dataKey]) {
          stash[dataKey][item.id] = item;
        }
      }
    };
  }

  function processOtherData(data) {
    if (!data?.data) return;
    const otherDataMappings = [
      { findKey: "findScene", key: "groups", nested: true },
      { findKey: "findScene", key: "galleries", nested: false },
      { findKey: "findScene", key: "performers", nested: false },
      { findKey: "findImage", key: "performers", nested: false },
      { findKey: "findGallery", key: "performers", nested: false },
      { findKey: "findGallery", key: "scenes", nested: false },
    ];

    for (const mapping of otherDataMappings) {
      if (data.data[mapping.findKey]?.[mapping.key]) {
        for (const item of data.data[mapping.findKey][mapping.key]) {
          const value = mapping.nested ? item[mapping.key.slice(0, -1)] : item;
          stash[mapping.key][value.id] = value;
        }
      }
    }
  }
})();
