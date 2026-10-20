(() => {
  // src/js/react-shim.js
  var React = window.PluginApi.React;

  // src/js/name.js
  var PLUGIN_NAME = "Cherry Pick";
  var PLUGIN_ID = "CherryPick";
  var slug = PLUGIN_ID.toLowerCase();
  var PLUGIN_ROUTE = "/plugins/" + slug;
  var FIELD_PREFIX = slug + "_";
  var STORAGE_PREFIX = slug + ":";
  var NAME_S = PLUGIN_NAME + (PLUGIN_NAME.endsWith("s") ? "'" : "'s");

  // src/js/runtime/api.js
  var api = window.PluginApi;
  var { React: React2, ReactDOM, GQL, patch, register, hooks, utils } = api;
  var { Bootstrap, Apollo, ReactRouterDOM, FontAwesomeSolid } = api.libraries;
  var components = api.components;
  var rendersSomething = (x) => typeof x === "string" || typeof x === "number" || Array.isArray(x) || x?.$$typeof != null;
  var patchAfter = (name, fn) => patch.after(name, (props, ...rest) => {
    const items = rest.filter(rendersSomething);
    const result = items.length > 1 ? React2.createElement(React2.Fragment, null, ...items) : items[0] ?? null;
    return fn(props, result);
  });
  var client = () => utils.StashService.getClient();
  var gql = Apollo.gql;
  async function query(doc2, variables, fetchPolicy = "network-only") {
    const { data } = await client().query({ query: doc2, variables, fetchPolicy });
    return data;
  }
  async function mutate(doc2, variables) {
    const { data } = await client().mutate({ mutation: doc2, variables });
    return data;
  }

  // src/js/runtime/store.js
  var { useEffect, useRef, useState } = React2;
  function createStore(initial) {
    let state = initial;
    const listeners2 = /* @__PURE__ */ new Set();
    const store2 = {
      get: () => state,
      set(patch2) {
        const next = typeof patch2 === "function" ? patch2(state) : patch2;
        if (!next) return;
        const prev = state;
        state = { ...state, ...next };
        for (const l of listeners2) l(state, prev);
      },
      subscribe(fn) {
        listeners2.add(fn);
        return () => listeners2.delete(fn);
      }
    };
    return store2;
  }
  function useStoreValue(store2, select = (s) => s) {
    const [, force] = useState(0);
    const selectRef = useRef(select);
    selectRef.current = select;
    const value = select(store2.get());
    const last = useRef(value);
    last.current = value;
    useEffect(() => {
      const check = () => {
        const next = selectRef.current(store2.get());
        if (!Object.is(next, last.current)) force((n) => n + 1);
      };
      check();
      return store2.subscribe(check);
    }, [store2]);
    return value;
  }

  // src/js/runtime/location.js
  var listeners = /* @__PURE__ */ new Set();
  var current = { pathname: location.pathname, search: location.search };
  window.PluginApi.Event.addEventListener("stash:location", (e) => {
    const loc = e.detail?.data?.location;
    if (!loc) return;
    const prev = current;
    current = { pathname: loc.pathname, search: loc.search };
    if (prev.pathname === current.pathname && prev.search === current.search)
      return;
    for (const l of listeners) l(current, prev);
  });
  var onLocation = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  var inSettings = (loc = current) => loc.pathname.startsWith("/settings");
  var onFrontPage = (loc = current) => loc.pathname === "/";

  // src/js/data/queries.js
  var SCENES = `
  query CherryPickScenes($filter: FindFilterType, $scene_filter: SceneFilterType, $ids: [ID!]) {
    findScenes(filter: $filter, scene_filter: $scene_filter, ids: $ids) {
      count
      scenes {
        id
        title
        date
        created_at
        updated_at
        rating100
        organized
        o_counter
        play_count
        play_duration
        play_history
        last_played_at
        resume_time
        files { duration video_codec width height }
        paths { screenshot }
        stash_ids { endpoint stash_id }
        studio { id }
        performers { id }
        tags { id }
        custom_fields
      }
    }
  }
`;
  var SCENE_LOOK = `
  query CherryPickSceneLook($ids: [ID!]) {
    findScenes(ids: $ids, filter: { per_page: -1 }) {
      scenes {
        id
        details
        paths { vtt preview }
        tags { id name parents { id name } }
      }
    }
  }
`;
  var PREVIEW_SETTINGS = `
  query CherryPickPreviewSettings {
    configuration {
      interface { soundOnPreview }
      general { previewSegments previewSegmentDuration }
    }
  }
`;
  var SCENE_TIMES = `
  query CherryPickSceneTimes($filter: FindFilterType) {
    findScenes(filter: $filter) {
      count
      scenes {
        id
        updated_at
        last_played_at
        o_counter
        o_history
      }
    }
  }
`;
  var PERFORMERS = `
  query CherryPickPerformers($filter: FindFilterType, $performer_filter: PerformerFilterType, $ids: [ID!]) {
    findPerformers(filter: $filter, performer_filter: $performer_filter, ids: $ids) {
      count
      performers {
        id
        name
        disambiguation
        gender
        rating100
        favorite
        image_path
        scene_count
        updated_at
        stash_ids { endpoint stash_id }
        custom_fields
      }
    }
  }
`;
  var PERFORMER_TIMES = `
  query CherryPickPerformerTimes($filter: FindFilterType) {
    findPerformers(filter: $filter) {
      count
      performers { id updated_at }
    }
  }
`;
  var LOOKUPS = `
  query CherryPickLookups {
    findTags(filter: { per_page: -1, sort: "id", direction: ASC }) {
      tags { id name }
    }
    findStudios(filter: { per_page: -1, sort: "id", direction: ASC }) {
      studios { id name parent_studio { id } }
    }
  }
`;
  var CONFIGURATION = `
  query CherryPickConfiguration {
    configuration {
      general { stashBoxes { endpoint api_key name } }
      plugins
    }
  }
`;
  var CONFIGURE_PLUGIN = `
  mutation CherryPickConfigurePlugin($plugin_id: ID!, $input: Map!) {
    configurePlugin(plugin_id: $plugin_id, input: $input)
  }
`;
  var PERFORMER_UPDATE = `
  mutation CherryPickPerformerUpdate($input: PerformerUpdateInput!) {
    performerUpdate(input: $input) {
      id
      gender
      rating100
      custom_fields
    }
  }
`;
  var PERFORMERS_WITH_FIELD = `
  query CherryPickPerformersWithField($performer_filter: PerformerFilterType) {
    findPerformers(performer_filter: $performer_filter, filter: { per_page: -1 }) {
      performers { id custom_fields }
    }
  }
`;
  var SCENES_WITH_FIELD = `
  query CherryPickScenesWithField($scene_filter: SceneFilterType) {
    findScenes(scene_filter: $scene_filter, filter: { per_page: -1 }) {
      scenes { id custom_fields }
    }
  }
`;
  var SCENE_SET_FIELDS = `
  mutation CherryPickSceneSetFields($input: SceneUpdateInput!) {
    sceneUpdate(input: $input) { id custom_fields }
  }
`;
  var PLUGINS = `
  query CherryPickPlugins {
    plugins { id name enabled }
  }
`;

  // src/js/model/rankings.js
  var ELO_FIELDS = [
    "hotornot_stats",
    "elo_matches",
    "performer_record",
    "scene_record",
    "xenith_stats",
    "xenith_record"
  ];
  function isRanked(customFields) {
    if (!customFields) return false;
    return ELO_FIELDS.some(
      (k) => customFields[k] != null && customFields[k] !== ""
    );
  }
  var MIRROR_FIELD = "restash_score";
  function isMirrored(rating100, customFields) {
    const score = customFields?.[MIRROR_FIELD];
    if (rating100 == null || score == null || score === "") return false;
    return Number(score) === rating100;
  }
  function pluginRating(rec) {
    if (isRanked(rec.custom_fields)) return "elo";
    if (isMirrored(rec.rating100, rec.custom_fields)) return "mirror";
    return null;
  }
  var LOW = [1, 9];
  var MID = [25, 39];
  var TOP = 40;
  var SHARE = { low: 0.7, mid: 0.25, top: 0.05 };
  var PRIME_MIN_SHARED = 3;
  var SLACK = 1.5;
  var inBand = (v, [lo, hi]) => v >= lo && v <= hi;
  var sum = (pairs) => pairs.reduce((n, [, c]) => n + c, 0);
  function primedIn(rated) {
    const count2 = /* @__PURE__ */ new Map();
    for (const r of rated)
      count2.set(r.rating100, (count2.get(r.rating100) || 0) + 1);
    const all = [...count2];
    const lows = all.filter(([v, n]) => inBand(v, LOW) && n >= PRIME_MIN_SHARED);
    if (!lows.length) return [];
    const runs = lows.length;
    const primed = (sum(lows) + runs) / SHARE.low;
    const values = new Set(lows.map(([v]) => v));
    const mids = all.filter(([v]) => inBand(v, MID)).sort((a, b) => b[1] - a[1]).slice(0, runs);
    if (mids.length && sum(mids) <= SLACK * SHARE.mid * primed + 2 * runs)
      for (const [v] of mids) values.add(v);
    const top = count2.get(TOP) || 0;
    if (top && top <= SLACK * SHARE.top * primed + 2 * runs) values.add(TOP);
    if (values.size === runs) return [];
    const hits = rated.filter((r) => values.has(r.rating100));
    return hits.length * 2 > rated.length ? hits : [];
  }
  function primedIds(rows, groupOf) {
    const rated = rows.filter((r) => r.rating100 != null && r.rating100 >= 1);
    const groups = [rated];
    if (groupOf) {
      const by = /* @__PURE__ */ new Map();
      for (const r of rated) {
        const g = groupOf(r);
        if (!by.has(g)) by.set(g, []);
        by.get(g).push(r);
      }
      groups.push(...by.values());
    }
    const out = /* @__PURE__ */ new Set();
    for (const list of groups) for (const r of primedIn(list)) out.add(r.id);
    return out;
  }
  function markRatingSources(list, localOf, groupOf) {
    const free = [];
    for (const rec of list) {
      const local2 = localOf(rec);
      local2.ratingSource = pluginRating(local2);
      if (!local2.ratingSource)
        free.push({ id: rec.id, rating100: local2.rating100, rec });
    }
    const primed = primedIds(free, groupOf && ((r) => groupOf(r.rec)));
    for (const r of free)
      if (primed.has(r.id)) localOf(r.rec).ratingSource = "primed";
  }
  var PLUGINS2 = [
    ["Ascension", /^ascension\b/i],
    ["HotOrNot", /^hot[\s_-]*or[\s_-]*not/i],
    ["Xenith", /^xenith\b/i]
  ];
  var enabledAs = (plugins, re) => (plugins || []).find(
    (p) => p.enabled && (re.test(p.id) || re.test(p.name || ""))
  );
  function rankingPlugins(plugins) {
    return PLUGINS2.filter(([, re]) => enabledAs(plugins, re)).map(([n]) => n);
  }
  var RESTASH = /^restash\b/i;
  var RESTASH_MIRROR = "mirrorToRating100";
  function ratingManagers(plugins, configs) {
    const out = rankingPlugins(plugins);
    const restash = enabledAs(plugins, RESTASH);
    const mirror = restash && configs?.[restash.id]?.[RESTASH_MIRROR];
    if (mirror === true || mirror === "true") out.push("Restash");
    return out;
  }

  // src/js/data/library.js
  var PAGE = 500;
  var STEP = 50;
  var FULL_RELOAD_MS = 7 * 24 * 3600 * 1e3;
  var REFRESH_MS = 2 * 60 * 1e3;
  var OVERLAP_MS = 60 * 1e3;
  var BULK_LIMIT = 2e3;
  var CACHE_VERSION = 5;
  var KEEP_FIELDS = /* @__PURE__ */ new Set([...ELO_FIELDS, MIRROR_FIELD]);
  function keepFields(row) {
    const cf = row.custom_fields;
    if (!cf) return row;
    let kept = null;
    for (const k in cf)
      if (KEEP_FIELDS.has(k) || k.startsWith(FIELD_PREFIX)) (kept || (kept = {}))[k] = cf[k];
    return { ...row, custom_fields: kept || {} };
  }
  var keepAll = (rows) => rows.map(keepFields);
  async function fetchPages(run2, query2, field, list, variables, onPage) {
    const out = [];
    for (let page = 1; ; page++) {
      const data = await run2(query2, {
        ...variables,
        filter: { per_page: PAGE, page, sort: "id", direction: "ASC" }
      });
      const result = data[field];
      out.push(...keepAll(result[list]));
      onPage?.(out.length, result.count);
      if (out.length >= result.count || !result[list].length) return out;
    }
  }
  var latest = (times) => times?.reduce(
    (a, t) => a == null || Date.parse(t) > Date.parse(a) ? t : a,
    null
  ) ?? null;
  var CHANGES = [
    { sort: "last_played_at", at: (s) => s.last_played_at, bulk: false },
    { sort: "last_o_at", at: (s) => latest(s.o_history), bulk: false },
    { sort: "updated_at", at: (s) => s.updated_at, bulk: true }
  ];
  var PERFORMER_CHANGE = { sort: "updated_at", at: (p) => p.updated_at };
  async function cursorsNow(run2) {
    const out = {};
    for (const { sort, at } of CHANGES) {
      const { findScenes } = await run2(SCENE_TIMES, {
        filter: { per_page: 1, page: 1, sort, direction: "DESC" }
      });
      out[sort] = findScenes.scenes[0] ? at(findScenes.scenes[0]) : null;
    }
    const { findPerformers } = await run2(PERFORMER_TIMES, {
      filter: { per_page: 1, page: 1, sort: "updated_at", direction: "DESC" }
    });
    out.performers = findPerformers.performers[0] ? PERFORMER_CHANGE.at(findPerformers.performers[0]) : null;
    return out;
  }
  var sameTime = (a, b) => a === b || a != null && b != null && Date.parse(a) === Date.parse(b);
  var current2 = (copy, row) => !!copy && sameTime(copy.updated_at, row.updated_at) && sameTime(copy.last_played_at, row.last_played_at) && copy.o_counter === row.o_counter;
  var currentPerformer = (copy, row) => !!copy && sameTime(copy.updated_at, row.updated_at);
  async function scan(run2, { query: query2, field, list, sort, at, was, isCurrent, limit, skipped }) {
    const since = was == null ? null : Date.parse(was) - OVERLAP_MS;
    const skip2 = skipped == null ? -Infinity : Date.parse(skipped);
    const ids = /* @__PURE__ */ new Set();
    let newest = was;
    let per = STEP;
    let page = 1;
    for (; ; ) {
      const data = await run2(query2, {
        filter: { per_page: per, page, sort, direction: "DESC" }
      });
      const rows = data[field][list];
      let done = rows.length < per;
      for (const r of rows) {
        const t = at(r);
        if (t == null || since != null && Date.parse(t) < since || Date.parse(t) <= skip2) {
          done = true;
          break;
        }
        if (!isCurrent(r)) ids.add(r.id);
        if (newest == null || Date.parse(t) > Date.parse(newest)) newest = t;
        if (limit != null && ids.size > limit)
          return { ids: [], newest, bulk: true };
      }
      if (done) break;
      if (per === STEP) {
        per = PAGE;
        page = 1;
      } else page++;
    }
    return { ids: [...ids], newest, bulk: false };
  }
  async function changedIds(run2, cached) {
    const copy = new Map(cached.scenes.map((s) => [s.id, s]));
    const ids = /* @__PURE__ */ new Set();
    const cursors = { skipped: { ...cached.cursors.skipped } };
    let bulk = false;
    for (const { sort, at, bulk: canWait } of CHANGES) {
      const found = await scan(run2, {
        query: SCENE_TIMES,
        field: "findScenes",
        list: "scenes",
        sort,
        at,
        was: cached.cursors[sort] ?? null,
        isCurrent: (r) => current2(copy.get(r.id), r),
        limit: canWait ? BULK_LIMIT : null,
        skipped: cursors.skipped[sort]
      });
      found.ids.forEach((id) => ids.add(id));
      cursors[sort] = found.newest;
      if (found.bulk) cursors.skipped[sort] = found.newest;
      bulk || (bulk = found.bulk);
    }
    return { ids: [...ids], cursors, bulk };
  }
  async function changedPerformerIds(run2, cached) {
    const copy = new Map(cached.performers.map((p) => [p.id, p]));
    return scan(run2, {
      query: PERFORMER_TIMES,
      field: "findPerformers",
      list: "performers",
      ...PERFORMER_CHANGE,
      was: cached.cursors.performers ?? null,
      isCurrent: (r) => currentPerformer(copy.get(r.id), r),
      limit: BULK_LIMIT,
      skipped: cached.cursors.skipped?.performers
    });
  }
  async function fetchByIds(run2, query2, field, list, ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += PAGE) {
      const data = await run2(query2, {
        ids: ids.slice(i, i + PAGE),
        filter: { per_page: -1 }
      });
      out.push(...keepAll(data[field][list]));
    }
    return out;
  }
  function merge(scenes, changed2) {
    const byId = new Map(scenes.map((s) => [s.id, s]));
    for (const s of changed2) byId.set(s.id, s);
    return [...byId.values()];
  }
  async function readCopy(cache4) {
    if (!cache4) return null;
    const [rows, meta2] = await Promise.all([
      cache4.get("library").catch(() => null),
      cache4.get("library-meta").catch(() => null)
    ]);
    if (rows?.version !== CACHE_VERSION || meta2?.version !== CACHE_VERSION)
      return null;
    if (meta2.rowsId !== rows.rowsId) return null;
    return { ...rows, ...meta2 };
  }
  async function loadLibrary({
    run: run2,
    cache: cache4,
    now = Date.now(),
    force = false,
    onProgress,
    current: current3 = null
  }) {
    const cached = current3?.version === CACHE_VERSION ? current3 : await readCopy(cache4);
    const usable = cached?.version === CACHE_VERSION && !force;
    if (usable && now - Date.parse(cached.syncedAt) < REFRESH_MS)
      return { ...cached, fromCache: true };
    const syncedAt = new Date(now).toISOString();
    let scenes = null;
    let performers = null;
    let cursors;
    let bulk = false;
    let fullAt = usable ? cached.fullAt : null;
    if (usable && now - Date.parse(fullAt) < FULL_RELOAD_MS) {
      const found = await changedIds(run2, cached);
      cursors = found.cursors;
      bulk = found.bulk;
      scenes = found.ids.length ? merge(
        cached.scenes,
        await fetchByIds(run2, SCENES, "findScenes", "scenes", found.ids)
      ) : cached.scenes;
      const { findScenes } = await run2(SCENES, { filter: { per_page: 0 } });
      if (findScenes.count !== scenes.length) scenes = null;
    }
    const full = !scenes;
    if (full) {
      cursors = await cursorsNow(run2);
      fullAt = syncedAt;
      bulk = false;
      scenes = await fetchPages(
        run2,
        SCENES,
        "findScenes",
        "scenes",
        {},
        (n, of) => onProgress?.({ kind: "scenes", n, of })
      );
    } else {
      const found = await changedPerformerIds(run2, cached);
      cursors.performers = found.newest;
      if (found.bulk) cursors.skipped.performers = found.newest;
      bulk || (bulk = found.bulk);
      performers = found.ids.length ? merge(
        cached.performers,
        await fetchByIds(
          run2,
          PERFORMERS,
          "findPerformers",
          "performers",
          found.ids
        )
      ) : cached.performers;
      const { findPerformers } = await run2(PERFORMERS, {
        filter: { per_page: 0 }
      });
      if (findPerformers.count !== performers.length) performers = null;
    }
    if (!performers)
      performers = await fetchPages(
        run2,
        PERFORMERS,
        "findPerformers",
        "performers",
        {},
        full ? (n, of) => onProgress?.({ kind: "performers", n, of }) : void 0
      );
    const { findTags, findStudios } = await run2(LOOKUPS, {});
    const tags = usable && sameRows(cached.tags, findTags.tags) ? cached.tags : findTags.tags;
    const studios = usable && sameRows(cached.studios, findStudios.studios) ? cached.studios : findStudios.studios;
    const unchanged = !full && scenes === cached.scenes && performers === cached.performers && tags === cached.tags && studios === cached.studios;
    const rowsId = unchanged ? cached.rowsId : syncedAt;
    const meta2 = { version: CACHE_VERSION, rowsId, syncedAt, fullAt, cursors };
    const rows = { version: CACHE_VERSION, rowsId, scenes, performers, tags, studios };
    if (cache4) {
      if (!unchanged) await cache4.set("library", rows).catch(() => {
      });
      await cache4.set("library-meta", meta2).catch(() => {
      });
    }
    return { ...rows, ...meta2, fromCache: false, unchanged, bulk };
  }
  function sameRows(a, b) {
    if (!a || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++)
      if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
    return true;
  }

  // src/js/storage/settings.js
  var MANIFEST_SETTINGS = [
    // off by default: Cherry Pick's front-page rows, unless the user asks for
    // one scene ready to play in their place (features/watchThis.jsx)
    { key: "watchThis", type: "BOOLEAN", def: false },
    { key: "showForYou", type: "BOOLEAN", def: true },
    { key: "showFollowRows", type: "BOOLEAN", def: true },
    { key: "showHallOfFame", type: "BOOLEAN", def: true },
    { key: "showMoreLikeThis", type: "BOOLEAN", def: true },
    { key: "outOfLibrary", type: "BOOLEAN", def: true },
    { key: "badges", type: "BOOLEAN", def: true },
    { key: "sceneLine", type: "BOOLEAN", def: true },
    { key: "medals", type: "BOOLEAN", def: true },
    { key: "performerLine", type: "BOOLEAN", def: true },
    { key: "relativeBadges", type: "BOOLEAN", def: false },
    { key: "excludedTags", type: "STRING", def: "" },
    { key: "learnFromMatches", type: "BOOLEAN", def: true },
    // written at first load by autoApplyToWrite, which can make it false
    { key: "autoApply", type: "BOOLEAN", def: true }
  ];
  var SETTING_KEYS = MANIFEST_SETTINGS.map((s) => s.key);
  var SETTING_DEFAULTS = Object.fromEntries(
    MANIFEST_SETTINGS.map((s) => [s.key, s.def])
  );
  function autoApplyToWrite({ value, wrote, managed }) {
    const want = !managed;
    const v = value === "true" ? true : value === "false" ? false : value;
    if (v == null) return want;
    if (wrote != null && v === wrote && want !== wrote) return want;
    return null;
  }
  function inManifestOrder(settings) {
    const rank = new Map(SETTING_KEYS.map((k, i) => [k, i]));
    return [...settings].sort(
      (a, b) => (rank.get(a.name) ?? 99) - (rank.get(b.name) ?? 99)
    );
  }

  // src/js/storage/tier1.js
  var DATA_KEYS = [
    "bracketPrefs",
    "notInterested",
    "dontLearn",
    "bracket",
    "hallOfFame",
    "applied",
    "consent",
    "curatorOffer",
    "autoApplyDefault",
    "snoozes"
  ];
  var ALL_KEYS = [...SETTING_KEYS, ...DATA_KEYS];
  function decode(v) {
    if (typeof v !== "string") return v ?? null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  var encode = (v) => v == null ? null : JSON.stringify(v);
  function fromConfig(map) {
    const m = map || {};
    const settings = { ...SETTING_DEFAULTS };
    for (const k of SETTING_KEYS) if (m[k] != null) settings[k] = m[k];
    return {
      settings,
      bracketPrefs: decode(m.bracketPrefs),
      notInterested: decode(m.notInterested) || [],
      dontLearn: decode(m.dontLearn) || [],
      brackets: {
        active: decode(m.bracket),
        history: decode(m.hallOfFame) || []
      },
      applied: decode(m.applied) || [],
      consent: decode(m.consent) || { stashdb: null },
      // 'hide' or 'keep' once the user answered (model/curator.js)
      curatorOffer: decode(m.curatorOffer),
      // the autoApply value Cherry Pick last wrote (autoApplyToWrite)
      autoApplyDefault: decode(m.autoApplyDefault),
      // Watch This's skipped and ignored scenes (model/watch.js Snooze)
      snoozes: decode(m.snoozes) || []
    };
  }
  function toConfig(s) {
    return {
      ...Object.fromEntries(SETTING_KEYS.map((k) => [k, s.settings[k]])),
      bracketPrefs: encode(s.bracketPrefs),
      notInterested: encode(s.notInterested),
      dontLearn: encode(s.dontLearn),
      bracket: encode(s.brackets.active),
      hallOfFame: encode(s.brackets.history),
      applied: encode(s.applied),
      consent: encode(s.consent),
      curatorOffer: encode(s.curatorOffer),
      autoApplyDefault: encode(s.autoApplyDefault),
      snoozes: encode(s.snoozes)
    };
  }
  var STATE_TO_CONFIG = {
    bracketPrefs: ["bracketPrefs"],
    notInterested: ["notInterested"],
    dontLearn: ["dontLearn"],
    brackets: ["bracket", "hallOfFame"],
    applied: ["applied"],
    consent: ["consent"],
    curatorOffer: ["curatorOffer"],
    snoozes: ["snoozes"]
  };
  var withCuratorAnswer = (map, answer, settings) => ({
    ...map,
    ...settings,
    curatorOffer: encode(answer)
  });
  function createTier1(io) {
    const now = io.now || (() => (/* @__PURE__ */ new Date()).toISOString());
    const log = io.log || (() => {
    });
    const pending2 = /* @__PURE__ */ new Set();
    const pendingOwn = /* @__PURE__ */ new Set();
    let pendingFull = null;
    let chain = Promise.resolve();
    const serial = (fn) => chain = chain.then(fn, fn);
    async function readModifyWrite(full, keys2, own = []) {
      const cur = await io.read();
      const mirror = io.mirror.get();
      const stale = !!cur && !!mirror?.updatedAt && (cur.updatedAt || "") < mirror.updatedAt;
      const write = new Set(
        !cur || cur.removedAt ? ALL_KEYS : stale ? [...DATA_KEYS, ...keys2] : keys2
      );
      const next = cur && !cur.removedAt ? { ...cur } : cur?.removedAt ? { removedAt: cur.removedAt } : {};
      const stashOwns = (k) => SETTING_KEYS.includes(k) && !own.includes(k) && !!cur && !cur.removedAt && cur[k] != null;
      for (const k of write)
        if (full[k] !== void 0 && !stashOwns(k)) next[k] = full[k];
      next.updatedAt = now();
      await io.write(next);
      io.mirror.set(next);
      log(
        !cur ? "configurePlugin: the map was missing; wrote back everything" : stale ? "configurePlugin: the map was stale; wrote back the plugin's data" : `configurePlugin: ${[...keys2].join(", ")}`
      );
      return "written";
    }
    return {
      // full: the whole map from the plugin's state; keys: what changed;
      // own: settings among them the user changed through the plugin itself
      // (Hide on cards, off Stash's Settings page), written over Stash's.
      save(full, keys2, own = []) {
        if (!keys2.length) return Promise.resolve("none");
        if (io.settingsOpen()) {
          keys2.forEach((k) => pending2.add(k));
          own.forEach((k) => pendingOwn.add(k));
          pendingFull = full;
          log(`deferred ${keys2.join(", ")}: Stash's Settings page is open`);
          return Promise.resolve("deferred");
        }
        return serial(() => readModifyWrite(full, keys2, own));
      },
      // Call when the user leaves Stash's Settings page.
      flush(full) {
        if (!pending2.size) return Promise.resolve("none");
        const keys2 = [...pending2];
        const own = [...pendingOwn];
        const map = full || pendingFull;
        pending2.clear();
        pendingOwn.clear();
        pendingFull = null;
        return serial(() => readModifyWrite(map, keys2, own));
      },
      pending: () => [...pending2],
      // Records a change in the mirror at once, ahead of a debounced save, so
      // a tab closed before the save still has it at the next load (the
      // mirror is then newer than Stash's map, and load restores it).
      stage(full, keys2) {
        const next = { ...io.mirror.get() || {} };
        for (const k of keys2) if (full[k] !== void 0) next[k] = full[k];
        next.updatedAt = now();
        io.mirror.set(next);
      },
      // The map to start from, and whether it came back from the mirror
      // ('missing' or 'stale'), in which case the caller writes it back.
      async load() {
        const cur = await io.read();
        const mirror = io.mirror.get();
        if (cur?.removedAt && cur.removedAt >= (mirror?.updatedAt || "")) {
          io.mirror.del();
          return { map: cur, restored: null };
        }
        if (!mirror) {
          if (cur && !cur.removedAt) io.mirror.set(cur);
          return { map: cur, restored: null };
        }
        if (!cur) return { map: { ...mirror }, restored: "missing" };
        const stale = (cur.updatedAt || "") < (mirror.updatedAt || "");
        const lost = DATA_KEYS.filter((k) => mirror[k] != null && cur[k] == null);
        if (stale || lost.length) {
          const map = { ...cur };
          for (const k of stale ? DATA_KEYS : lost) map[k] = mirror[k];
          return { map, restored: stale ? "stale" : "missing" };
        }
        return { map: cur, restored: null };
      },
      // "Remove Cherry Pick data": a tombstone stops other browsers' mirrors
      // from bringing the data back.
      async remove() {
        await serial(async () => {
          await io.write({ removedAt: now() });
          io.mirror.del();
        });
      }
    };
  }

  // node_modules/idb-keyval/dist/index.js
  function promisifyRequest(request) {
    return new Promise((resolve, reject) => {
      request.oncomplete = request.onsuccess = () => resolve(request.result);
      request.onabort = request.onerror = () => reject(request.error);
    });
  }
  function createStore2(dbName, storeName) {
    let dbp;
    const getDB = () => {
      if (dbp)
        return dbp;
      const request = indexedDB.open(dbName);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      dbp = promisifyRequest(request);
      dbp.then((db2) => {
        db2.onclose = () => dbp = void 0;
      }, () => {
        dbp = void 0;
      });
      return dbp;
    };
    return (txMode, callback) => getDB().then((db2) => callback(db2.transaction(storeName, txMode).objectStore(storeName)));
  }
  var defaultGetStoreFunc;
  function defaultGetStore() {
    if (!defaultGetStoreFunc) {
      defaultGetStoreFunc = createStore2("keyval-store", "keyval");
    }
    return defaultGetStoreFunc;
  }
  function get(key, customStore = defaultGetStore()) {
    return customStore("readonly", (store2) => promisifyRequest(store2.get(key)));
  }
  function set(key, value, customStore = defaultGetStore()) {
    return customStore("readwrite", (store2) => {
      store2.put(value, key);
      return promisifyRequest(store2.transaction);
    });
  }
  function getMany(keys2, customStore = defaultGetStore()) {
    return customStore("readonly", (store2) => Promise.all(keys2.map((key) => promisifyRequest(store2.get(key)))));
  }
  function del(key, customStore = defaultGetStore()) {
    return customStore("readwrite", (store2) => {
      store2.delete(key);
      return promisifyRequest(store2.transaction);
    });
  }
  function delMany(keys2, customStore = defaultGetStore()) {
    return customStore("readwrite", (store2) => {
      keys2.forEach((key) => store2.delete(key));
      return promisifyRequest(store2.transaction);
    });
  }
  function clear(customStore = defaultGetStore()) {
    return customStore("readwrite", (store2) => {
      store2.clear();
      return promisifyRequest(store2.transaction);
    });
  }
  function eachCursor(store2, callback) {
    store2.openCursor().onsuccess = function() {
      if (!this.result)
        return;
      callback(this.result);
      this.result.continue();
    };
    return promisifyRequest(store2.transaction);
  }
  function keys(customStore = defaultGetStore()) {
    return customStore("readonly", (store2) => {
      if (store2.getAllKeys) {
        return promisifyRequest(store2.getAllKeys());
      }
      const items = [];
      return eachCursor(store2, (cursor) => items.push(cursor.key)).then(() => items);
    });
  }

  // src/js/storage/tier3.js
  var KEYS = {
    mirror: STORAGE_PREFIX + "config-mirror",
    signals: STORAGE_PREFIX + "for-you-signals",
    stashdb: STORAGE_PREFIX + "stashdb-cache",
    // the last cross-validation's numbers, for the gate until this load's
    // own finishes (runtime/engine.js)
    cv: STORAGE_PREFIX + "last-cv"
  };
  var local = {
    get(key) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
      }
    },
    del(key) {
      try {
        localStorage.removeItem(key);
      } catch {
      }
    }
  };
  var idb = null;
  var db = () => idb || (idb = createStore2(PLUGIN_ID.toLowerCase(), "cache"));
  var cache = {
    get: (key) => get(key, db()).catch(() => null),
    set: (key, value) => set(key, value, db()).catch(() => {
    }),
    del: (key) => del(key, db()).catch(() => {
    }),
    // for the StashDB cache's stats and clearing (its keys share a prefix)
    keys: () => keys(db()).catch(() => []),
    getMany: (list) => getMany(list, db()).catch(() => list.map(() => void 0)),
    delMany: (list) => delMany(list, db()).catch(() => {
    })
  };
  async function clearTier3() {
    for (const key of Object.values(KEYS)) local.del(key);
    await clear(db()).catch(() => {
    });
  }

  // src/js/model/util.js
  var META_TAGS = /* @__PURE__ */ new Set([
    "Professional Production",
    "4K Available",
    "Full HD Available",
    "HD Available",
    "Trailer",
    "Photos",
    "Redistribution",
    "Exclusive",
    "Series",
    "Behind the Scenes"
  ]);
  function isPlaceholderTag(tag) {
    if (!tag || !tag.name) return true;
    if (META_TAGS.has(tag.name)) return true;
    if (/^Award Winner/.test(tag.name)) return true;
    if (/^[[_(#!.~-]|^(todo|tbd|unsorted|unorganized|placeholder)/i.test(tag.name))
      return true;
    if (/ ★\s*:\s*[0-5]$/.test(tag.name) || tag.name.endsWith(" 📁")) return true;
    return false;
  }
  function sceneRating(scene, overrides) {
    if (!scene.owned) return null;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, scene.id))
      return overrides[scene.id];
    return scene.local.rating100;
  }
  function ownRating(scene, overrides) {
    if (!scene.owned) return null;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, scene.id))
      return overrides[scene.id];
    return scene.local.ratingSource ? null : scene.local.rating100;
  }
  var dayFmt = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  var localDay = (iso) => dayFmt.format(new Date(iso));
  function timeAgo(iso, now = Date.now()) {
    const days = Math.round((now - Date.parse(iso)) / 864e5);
    if (days < 1) return "today";
    if (days < 2) return "yesterday";
    if (days < 30) return `${days} days ago`;
    const months = Math.round(days / 30.4);
    if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
    const years = Math.round(days / 365 * 10) / 10;
    return `${years} year${years === 1 ? "" : "s"} ago`;
  }
  function approx(n) {
    if (n == null) return "";
    const digits = Math.max(0, Math.floor(Math.log10(n)) - 1);
    const r = Math.round(n / 10 ** digits) * 10 ** digits;
    return "~" + r.toLocaleString("en-US");
  }
  var GENDERS = [
    ["FEMALE", "Female"],
    ["MALE", "Male"],
    ["TRANSGENDER_FEMALE", "Trans female"],
    ["TRANSGENDER_MALE", "Trans male"],
    ["NON_BINARY", "Non-binary"],
    ["INTERSEX", "Intersex"]
  ];
  var genderLabel = (g) => GENDERS.find(([k]) => k === g)?.[1] || null;
  var defaultGender = (p) => p?.local ? p.local.gender : p?.stashdbGender;
  var resolveGender = defaultGender;
  function pronoun(performer) {
    const g = performer ? resolveGender(performer) : null;
    if (g === "FEMALE" || g === "TRANSGENDER_FEMALE") return "her";
    if (g === "MALE" || g === "TRANSGENDER_MALE") return "his";
    return "their";
  }
  var fmtStars = (x) => (Math.round(x * 10) / 10).toFixed(1);
  var andList = (items) => items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0] || "";

  // src/js/model/behaviour.js
  var WATCHED_SHARE = 0.1;
  function playWeight(scene) {
    const l = scene.local;
    if (!l || !l.play_count) return 0;
    if (!l.play_duration) return 1;
    const paid = l.play_duration / (WATCHED_SHARE * (scene.duration || 1800));
    return paid < 1 ? 0 : Math.min(1, paid / l.play_count);
  }
  var cache2 = /* @__PURE__ */ new WeakMap();
  function behaviourOf(scene) {
    const l = scene.local;
    if (!l || !l.play_count) return null;
    if (cache2.has(l)) return cache2.get(l);
    const weight = playWeight(scene);
    let b = null;
    if (weight) {
      const duration = scene.duration || 1800;
      const watchThrough = Math.min(1, l.play_duration / duration);
      const days = new Set(l.play_history.map(localDay)).size;
      const rewatchDays = Math.max(0, days * weight - 1);
      const o = l.o_counter || 0;
      const score = 0.5 * watchThrough + 0.3 * (1 - Math.exp(-rewatchDays / 2)) + 0.2 * (1 - Math.exp(-o / 1.5));
      b = { score, watchThrough, days, rewatchDays, o, plays: l.play_count };
    }
    cache2.set(l, b);
    return b;
  }
  function barelyPlayed(scene) {
    const b = behaviourOf(scene);
    if (!b) return true;
    return b.rewatchDays < 1 && b.watchThrough < 0.9;
  }

  // src/js/model/signals.js
  function popularity(db2, scene, contextPerformerId) {
    const out = {
      heldBy: scene.heldBy,
      held: scene.heldBy ? `Held by ${approx(scene.heldBy)} StashDB users` : null,
      global: scene.globalPopularityRank || null,
      performer: null,
      studio: null
    };
    const pr = db2.performerRank.get(scene.id) || [];
    const pick2 = contextPerformerId && pr.find((x) => x.performerId === contextPerformerId) || pr.slice().sort((a, b) => topShare(db2, a) - topShare(db2, b))[0];
    if (pick2) {
      const p = db2.performers.get(pick2.performerId);
      out.performer = {
        performer: p,
        rank: pick2.rank,
        top: p.sceneCount ? niceTop(pick2.rank / p.sceneCount) : null,
        of: p.sceneCount
      };
    }
    const sr = db2.studioRank.get(scene.id);
    if (sr) out.studio = { studio: db2.studios.get(sr.studioId), rank: sr.rank };
    return out;
  }
  function topShare(db2, x) {
    const p = db2.performers.get(x.performerId);
    return x.rank / (p.sceneCount || 1);
  }
  function niceTop(share) {
    for (const t of [1, 2, 5, 10, 25, 50]) if (share <= t / 100) return t;
    return null;
  }
  function popularityLine(pop, contextPerformerId) {
    if (pop.performer && (contextPerformerId || !pop.global)) {
      const p = pop.performer.performer;
      return pop.performer.top ? `Top ${pop.performer.top}% of ${p.name}'s scenes` : `#${pop.performer.rank} of ${p.name}'s scenes`;
    }
    if (pop.global) return `#${pop.global} most popular on StashDB`;
    if (pop.studio)
      return `#${pop.studio.rank} at ${pop.studio.studio.name} on StashDB`;
    return null;
  }
  function performerRankPhrase(pop) {
    if (!pop.performer) return null;
    const p = pop.performer.performer;
    const of = p.sceneCount ? `${p.sceneCount.toLocaleString("en-US")} ` : "";
    return `#${pop.performer.rank} of ${pronoun(p)} ${of}scenes on StashDB`;
  }

  // src/js/model/taste.js
  var PARAMS = {
    lambda: { p: 3, s: 2, t: 4, b: 0.6 },
    tagScale: 2,
    // tag features are 2/√(#tags) so long tag lists don't dominate
    useBehaviour: true,
    minTagSupport: 3,
    // a tag needs this many training scenes to get a weight
    maxTagShare: 0.85,
    // ...and must not be on nearly every scene
    pseudoWeight: 0.3,
    iterations: 60,
    folds: 5,
    seed: 20261015
  };
  var MIN_RATED = 10;
  function sceneFeatures(scene, params = PARAMS) {
    const f = [];
    for (const p of scene.performers) f.push(["p:" + p.id, 1]);
    if (scene.studio) {
      f.push(["s:" + scene.studio.id, 1]);
      if (scene.studio.parent) f.push(["s:" + scene.studio.parent.id, 1]);
    }
    const tags = scene.tags.filter((t) => !isPlaceholderTag(t));
    const x = tags.length ? params.tagScale / Math.sqrt(tags.length) : 0;
    for (const t of tags) f.push(["t:" + t.id, x]);
    return f;
  }
  var group = (key) => key[0];
  function buildSamples(db2, overrides, skip2, rating = ownRating) {
    const rated = [];
    const watchedUnrated = [];
    for (const s of db2.owned) {
      if (skip2 && skip2.has(s.id)) continue;
      const r = rating(s, overrides);
      const b = behaviourOf(s);
      if (r != null) rated.push({ scene: s, y: r / 20, b: b?.score ?? null });
      else if (b) watchedUnrated.push({ scene: s, b: b.score });
    }
    return { rated, watchedUnrated };
  }
  function fit(rated, watchedUnrated, params = PARAMS) {
    const bs = [...rated, ...watchedUnrated].map((x) => x.b).filter((b) => b != null);
    const bMean = bs.length ? bs.reduce((a2, b) => a2 + b, 0) / bs.length : 0.5;
    const withB = rated.filter((x) => x.b != null);
    let a = 3, c = 2;
    if (withB.length >= 5) {
      const mb = withB.reduce((s, x) => s + x.b, 0) / withB.length;
      const my = withB.reduce((s, x) => s + x.y, 0) / withB.length;
      let sxy = 0, sxx = 0;
      for (const x of withB) {
        sxy += (x.b - mb) * (x.y - my);
        sxx += (x.b - mb) ** 2;
      }
      c = sxx > 1e-9 ? sxy / sxx : 0;
      a = my - c * mb;
    }
    const samples = [
      ...rated.map((x) => ({ scene: x.scene, y: x.y, w: 1, b: x.b })),
      ...watchedUnrated.map((x) => ({
        scene: x.scene,
        y: Math.min(5, Math.max(1, a + c * x.b)),
        w: params.pseudoWeight,
        b: x.b,
        pseudo: true
      }))
    ];
    const tagCount2 = /* @__PURE__ */ new Map();
    for (const s of samples)
      for (const [k] of sceneFeatures(s.scene, params))
        if (k[0] === "t") tagCount2.set(k, (tagCount2.get(k) || 0) + 1);
    const keep = (k) => {
      if (k[0] !== "t") return true;
      const n2 = tagCount2.get(k) || 0;
      return n2 >= params.minTagSupport && n2 <= params.maxTagShare * samples.length;
    };
    const X = samples.map(
      (s) => sceneFeatures(s.scene, params).filter(([k]) => keep(k))
    );
    const bx = Float64Array.from(samples, (s) => s.b == null ? 0 : s.b - bMean);
    const cols = /* @__PURE__ */ new Map();
    X.forEach(
      (row, i) => row.forEach(([k, x]) => {
        if (!cols.has(k)) cols.set(k, []);
        cols.get(k).push([i, x]);
      })
    );
    const keys2 = [...cols.keys()];
    const colRows = keys2.map((k) => Int32Array.from(cols.get(k), ([i]) => i));
    const colX = keys2.map((k) => Float64Array.from(cols.get(k), ([, x]) => x));
    const colLambda = keys2.map((k) => params.lambda[group(k)]);
    const wts = Float64Array.from(samples, (s) => s.w);
    const wv = new Float64Array(keys2.length);
    let beta = 0;
    const sw = samples.reduce((s, x) => s + x.w, 0);
    let mu = sw ? samples.reduce((s, x) => s + x.w * x.y, 0) / sw : 3;
    const r = Float64Array.from(samples, (s) => s.y - mu);
    const n = r.length;
    for (let it = 0; sw && it < params.iterations; it++) {
      let d = 0;
      for (let i = 0; i < n; i++) d += wts[i] * r[i];
      d /= sw;
      mu += d;
      for (let i = 0; i < n; i++) r[i] -= d;
      for (let j = 0; j < keys2.length; j++) {
        const rows = colRows[j];
        const xs = colX[j];
        const w0 = wv[j];
        let num = 0, den = colLambda[j];
        for (let q = 0; q < rows.length; q++) {
          const i = rows[q];
          const x = xs[q];
          num += wts[i] * x * (r[i] + x * w0);
          den += wts[i] * x * x;
        }
        const w1 = num / den;
        if (w1 !== w0) {
          for (let q = 0; q < rows.length; q++) r[rows[q]] -= xs[q] * (w1 - w0);
          wv[j] = w1;
        }
      }
      if (params.useBehaviour) {
        let num = 0, den = params.lambda.b;
        for (let i = 0; i < n; i++) {
          num += wts[i] * bx[i] * (r[i] + bx[i] * beta);
          den += wts[i] * bx[i] * bx[i];
        }
        const b1 = num / den;
        for (let i = 0; i < n; i++) r[i] -= bx[i] * (b1 - beta);
        beta = b1;
      }
    }
    const W = new Map(keys2.map((k, j) => [k, wv[j]]));
    const ratedMean = rated.length ? rated.reduce((s, x) => s + x.y, 0) / rated.length : 3;
    const pseudo = samples.filter((s) => s.pseudo);
    const pseudoMean = pseudo.length ? pseudo.reduce((s, x) => s + x.y, 0) / pseudo.length : null;
    return {
      mu,
      W,
      beta,
      bMean,
      calib: { a, c },
      ratedMean,
      pseudoMean,
      nRated: rated.length,
      nPseudo: watchedUnrated.length,
      params
    };
  }
  function predict(model, scene, extra) {
    const parts = [];
    for (const [k, x] of sceneFeatures(scene, model.params)) {
      let w = model.W.get(k) || 0;
      if (extra?.featureDelta) w += extra.featureDelta.get(k) || 0;
      if (extra?.performerOffset && k[0] === "p")
        w += extra.performerOffset.get(k.slice(2)) || 0;
      if (extra?.penalty) w += extra.penalty.get(k) || 0;
      if (w) parts.push({ key: k, value: w * x });
    }
    const b = scene.owned && model.params.useBehaviour ? behaviourOf(scene) : null;
    if (b)
      parts.push({
        key: "b",
        value: model.beta * (b.score - model.bMean),
        behaviour: b
      });
    if (extra?.sceneOffset) parts.push({ key: "o", value: extra.sceneOffset });
    const raw = model.mu + parts.reduce((s, p) => s + p.value, 0);
    return { value: Math.min(5, Math.max(0.5, raw)), raw, parts };
  }
  function shuffled(arr, seed) {
    let a = seed | 0;
    const rand = () => {
      a = a + 1831565813 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  function crossValidate(rated, watchedUnrated, params = PARAMS) {
    const steps = crossValidateSteps(rated, watchedUnrated, params);
    for (; ; ) {
      const { done, value } = steps.next();
      if (done) return value;
    }
  }
  function* crossValidateSteps(rated, watchedUnrated, params = PARAMS) {
    if (rated.length < MIN_RATED) return null;
    const order = shuffled(rated, params.seed);
    const k = params.folds;
    const rows = [];
    for (let f = 0; f < k; f++) {
      const test = order.filter((_, i) => i % k === f);
      const train = order.filter((_, i) => i % k !== f);
      const m = fit(train, watchedUnrated, params);
      for (const t of test) {
        const p = predict(m, t.scene).value;
        rows.push({ scene: t.scene, y: t.y, pred: p, base: m.ratedMean });
      }
      if (f < k - 1) yield;
    }
    const mae = (key) => rows.reduce((s, r) => s + Math.abs(r[key] - r.y), 0) / rows.length;
    const within = (key) => rows.filter((r) => Math.abs(r[key] - r.y) <= 0.5).length / rows.length;
    return {
      n: rows.length,
      folds: k,
      maeModel: mae("pred"),
      maeBase: mae("base"),
      withinModel: within("pred"),
      withinBase: within("base"),
      rows
    };
  }

  // src/js/model/foryou.js
  var FY = {
    size: 12,
    halfLifeDays: 7,
    windowDays: 14,
    perPerformer: 2,
    explore: { 3: "forgotten", 8: "nearmiss" },
    // slot index -> kind (2 of 12, about 20%)
    minLibrary: 30,
    newDays: 30
  };
  var DAY = 864e5;
  var clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  var r2 = (x) => Math.round(x * 100) / 100;
  var NUM = [
    "no",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten"
  ];
  var numWord = (n) => NUM[n] || String(n);
  var MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  function playMap(db2) {
    const out = /* @__PURE__ */ new Map();
    for (const s of db2.owned)
      out.set(
        s.id,
        playWeight(s) ? s.local.play_history.map((t) => Date.parse(t)).sort((a, b) => a - b) : []
      );
    return out;
  }
  function excludedTagIds(db2, text) {
    const names2 = new Set(
      String(text || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)
    );
    if (!names2.size) return /* @__PURE__ */ new Set();
    return new Set(
      [...db2.tags.values()].filter((t) => names2.has(t.name.toLowerCase())).map((t) => t.id)
    );
  }
  function momentumOf(db2, plays, skip2, now) {
    const feat = /* @__PURE__ */ new Map();
    let total = 0;
    let count2 = 0;
    const lib = /* @__PURE__ */ new Map();
    const bumpLib = (k) => lib.set(k, (lib.get(k) || 0) + 1);
    for (const s of db2.owned) {
      for (const t of s.tags) if (!isPlaceholderTag(t)) bumpLib("t:" + t.id);
      if (s.studio) bumpLib("s:" + s.studio.id);
      if (s.studio?.parent) bumpLib("s:" + s.studio.parent.id);
      if (skip2.has(s.id)) continue;
      const q = playWeight(s);
      for (const at of plays.get(s.id) || []) {
        const age2 = (now - at) / DAY;
        if (age2 < 0 || age2 > FY.windowDays) continue;
        const w = q * 0.5 ** (age2 / FY.halfLifeDays);
        total += w;
        count2++;
        const pw = w / Math.sqrt(Math.max(1, s.performers.length / 2));
        const keys2 = s.performers.map((p) => ["p:" + p.id, pw]);
        if (s.studio) keys2.push(["s:" + s.studio.id, w]);
        if (s.studio?.parent) keys2.push(["s:" + s.studio.parent.id, w]);
        for (const t of s.tags)
          if (!isPlaceholderTag(t)) keys2.push(["t:" + t.id, w]);
        for (const [k, kw] of keys2) {
          let f = feat.get(k);
          if (!f)
            feat.set(k, f = { m: 0, plays: 0, scenes: /* @__PURE__ */ new Set(), oldest: 0 });
          f.m += kw;
          f.plays++;
          f.scenes.add(s.id);
          f.oldest = Math.max(f.oldest, age2);
        }
      }
    }
    const n = db2.owned.length || 1;
    for (const [k, f] of feat)
      if (k[0] !== "p")
        f.lift = total ? Math.max(0, f.m / total - (lib.get(k) || 0) / n) : 0;
    return { feat, total, count: count2 };
  }
  function rewatchRate(db2, plays, skip2) {
    let played = 0;
    let again = 0;
    for (const s of db2.owned) {
      if (skip2.has(s.id)) continue;
      const ps = plays.get(s.id) || [];
      if (!ps.length) continue;
      played++;
      const days = new Set(ps.map((t) => localDay(new Date(t).toISOString())));
      again += clamp(days.size * playWeight(s) - 1, 0, 1);
    }
    return played ? again / played : 0;
  }
  function context(M, state, opts = {}) {
    const db2 = M.db;
    const now = db2.asOf;
    const skip2 = new Set(state.dontLearn.map((d) => d.sceneId));
    const plays = playMap(db2);
    const mom = momentumOf(db2, plays, skip2, now);
    const rewatch = rewatchRate(db2, plays, skip2);
    return {
      M,
      db: db2,
      state,
      now,
      skip: skip2,
      plays,
      mom,
      rewatch,
      hasStashdb: opts.hasStashdb ?? db2.hasStashdb,
      hidden: new Set(state.notInterested.map((n) => n.sceneId)),
      excluded: excludedTagIds(db2, state.settings?.excludedTags)
    };
  }
  var allowed = (ctx, s) => !ctx.hidden.has(s.id) && !s.tags.some((t) => ctx.excluded.has(t.id));
  var lastPlay = (ctx, s) => {
    const ps = ctx.plays.get(s.id) || [];
    return ps.length ? ps[ps.length - 1] : null;
  };
  var EMPTY_SIGNALS = {
    opens: {},
    passes: {},
    lastShown: [],
    lastShownOpened: []
  };
  function rowSignal(signals, sceneId) {
    let fb = 0;
    fb += 0.12 * Math.min(2, signals.opens[sceneId] || 0);
    const pa = signals.passes[sceneId] || 0;
    if (pa >= 3) fb -= Math.min(0.3, 0.1 * (pa - 2));
    return fb;
  }
  function visitSignals(signals, skip2) {
    const passes = { ...signals.passes };
    for (const id of signals.lastShown)
      if (!signals.lastShownOpened.includes(id) && !skip2.has(id))
        passes[id] = (passes[id] || 0) + 1;
    return { ...signals, passes };
  }
  function shownSignals(visit, shownIds, opened = []) {
    return { ...visit, lastShown: shownIds, lastShownOpened: opened };
  }
  function openSignals(signals, sceneId, skip2) {
    if (skip2 && skip2.has(sceneId)) return signals;
    return {
      ...signals,
      opens: { ...signals.opens, [sceneId]: (signals.opens[sceneId] || 0) + 1 },
      passes: { ...signals.passes, [sceneId]: 0 },
      lastShownOpened: [...signals.lastShownOpened, sceneId]
    };
  }
  var STATED = { favorite: 0.5, perStar: 0.25 };
  function statedFor(ctx, s) {
    const { M, db: db2 } = ctx;
    const share = M.ratingsToGo / MIN_RATED;
    if (!share) return { value: 0, source: null };
    let best = null;
    let worst = 0;
    for (const credit of s.performers) {
      const favorite = db2.favoritePerformerIds.has(credit.id);
      const r = M.performerRating(credit.id);
      const v = (favorite ? STATED.favorite : 0) + (r != null ? STATED.perStar * (r / 20 - 3) : 0);
      if (v > 0 && (!best || v > best.value))
        best = { performer: db2.performers.get(credit.id), favorite, r, value: v };
      worst = Math.min(worst, v);
    }
    return { value: share * ((best?.value || 0) + worst), source: best };
  }
  function tasteOf(ctx, s, signals) {
    const { M } = ctx;
    const r = s.owned ? M.rating(s) : null;
    const est = r != null ? r / 20 : M.prediction(s.id).value;
    const base = r != null ? 0.6 * (est - M.userMean) : est - M.userMean;
    const fb = ctx.skip.has(s.id) ? 0 : rowSignal(signals, s.id);
    const stated = r != null ? 0 : statedFor(ctx, s).value;
    return {
      value: base + fb + stated,
      base,
      feedback: fb,
      stated,
      rated: r != null
    };
  }
  function momentumFor(ctx, s) {
    const { feat, total } = ctx.mom;
    let perf = 0;
    let topP = null;
    for (const credit of s.performers) {
      const f = feat.get("p:" + credit.id);
      if (f && (!topP || f.m > topP.f.m))
        topP = { p: ctx.db.performers.get(credit.id), f };
    }
    if (topP) perf = 0.5 * (1 - Math.exp(-topP.f.m / 1.5));
    let studio = 0;
    let topS = null;
    for (const st of [s.studio, s.studio?.parent].filter(Boolean)) {
      const f = feat.get("s:" + st.id);
      if (f && f.lift > 0 && (!topS || f.lift > topS.f.lift)) topS = { st, f };
    }
    if (topS) studio = 0.3 * topS.f.lift;
    let tag = 0;
    let topT = null;
    if (total) {
      const lifts = s.tags.filter((t) => !isPlaceholderTag(t)).map((t) => ({ t, f: feat.get("t:" + t.id) })).filter((x) => x.f && x.f.lift > 0).sort((a, b) => b.f.lift - a.f.lift);
      if (lifts.length) {
        topT = lifts[0];
        tag = 0.3 * lifts.slice(0, 3).reduce((a, x) => a + x.f.lift, 0) / 3;
      }
    }
    const parts = [
      ["performer", perf, topP],
      ["studio", studio, topS],
      ["tag", tag, topT]
    ].sort((a, b) => b[1] - a[1]);
    return {
      value: perf + studio + tag,
      perf,
      studio,
      tag,
      source: parts[0][1] > 0 ? { kind: parts[0][0], ...parts[0][2] } : null
    };
  }
  var SEEN = 0.4;
  function freshnessFor(ctx, s) {
    if (!s.owned) return { value: 0.3, kind: "never" };
    const last = lastPlay(ctx, s);
    const addedDays = (ctx.now - Date.parse(s.local.created_at)) / DAY;
    if (!last) {
      const isNew = addedDays <= FY.newDays;
      return {
        value: 0.3 + (isNew ? 0.15 : 0),
        kind: isNew ? "new" : "never",
        addedDays,
        // Stash has plays of it, all looks
        looked: !!s.local.play_count
      };
    }
    const d = (ctx.now - last) / DAY;
    const P = 1.4 * (1 - 0.5 * ctx.rewatch);
    const w = Math.min(1, ctx.rewatch / 0.5);
    const value = -P * 0.5 ** (d / 14) + 0.35 * w * clamp((d - 60) / 120, 0, 1) - SEEN * (1 - w);
    return {
      value,
      kind: d < 14 ? "recent" : d >= 90 ? "long" : "mid",
      days: d,
      last
    };
  }
  function monthOf(ctx, ms) {
    const d = new Date(ms);
    const same = d.getUTCFullYear() === new Date(ctx.now).getUTCFullYear();
    return MONTHS[d.getUTCMonth()] + (same ? "" : " " + d.getUTCFullYear());
  }
  function momentumPhrase(ctx, src, sceneId) {
    const when2 = src.f.oldest <= 7 ? "this week" : "in the last two weeks";
    const n = src.f.scenes.size - (src.f.scenes.has(sceneId) ? 1 : 0);
    if (n <= 0) return null;
    if (src.kind === "performer")
      return `Because you watched ${numWord(n)} of ${src.p.name}'s ${when2}`;
    if (src.kind === "studio")
      return `Because you watched ${numWord(n)} ${src.st.name} scene${n === 1 ? "" : "s"} ${when2}`;
    return `Like your last few plays: ${src.t.name}`;
  }
  function tastePhrase(ctx, s) {
    return tastePhrases(ctx, s)[0] ?? null;
  }
  function tastePhrases(ctx, s) {
    const st = statedFor(ctx, s);
    if (st.source && st.value >= 0.1) {
      const { performer: p, favorite, r } = st.source;
      if (r != null && (r >= 80 || !favorite))
        return [`You rated ${p.name} ${fmtStars(r / 20).replace(".0", "")}★`];
      return [`With ${p.name}, one of your favorites`];
    }
    return (ctx.M.reasons?.(s.id, true) ?? []).map((r) => r.text);
  }
  function freshPhrase(ctx, s, f) {
    const r = ctx.M.rating(s);
    const rated = r != null && r >= 80 ? `; you rated it ${fmtStars(r / 20).replace(".0", "")}★` : "";
    if (f.kind === "new") return "New in your library";
    if (f.kind === "never") {
      const never = f.looked ? "Not watched yet" : "Never played";
      const t = tastePhrase(ctx, s);
      return t ? `${never} · ${t[0].toLowerCase() + t.slice(1)}` : never;
    }
    if (f.kind === "long")
      return `Not watched since ${monthOf(ctx, f.last)}` + rated;
    if (f.kind === "mid")
      return `Last watched ${timeAgo(new Date(f.last).toISOString(), ctx.now)}` + rated;
    return null;
  }
  function reasonOptions(ctx, it) {
    if (it.kind === "forgotten")
      return [
        {
          kind: "explore",
          text: freshPhrase(ctx, it.scene, it.f) || "One of your favorites"
        }
      ];
    if (it.kind === "nearmiss") {
      const t = tastePhrase(ctx, it.scene);
      return [
        {
          kind: "explore",
          text: "Worth a try" + (t ? ": " + t[0].toLowerCase() + t.slice(1) : "")
        }
      ];
    }
    const out = [];
    const mp = it.m.source && it.m.value >= 0.2 ? momentumPhrase(ctx, it.m.source, it.scene.id) : null;
    if (mp) out.push({ kind: "momentum", text: mp });
    const fp = freshPhrase(ctx, it.scene, it.f);
    if (fp) out.push({ kind: "fresh", text: fp });
    for (const text of tastePhrases(ctx, it.scene))
      out.push({ kind: "taste", text });
    out.push({
      kind: "taste",
      text: ctx.M.ratingsToGo ? "From your library" : "A lot like scenes you rate well"
    });
    return out;
  }
  var REASON_SHARE = 0.5;
  function assignReasons(ctx, cards) {
    const cap2 = Math.ceil(cards.length * REASON_SHARE);
    const kinds = /* @__PURE__ */ new Map();
    const texts = /* @__PURE__ */ new Map();
    return cards.map((card) => {
      const options = reasonOptions(ctx, card);
      const pick2 = options.find(
        (o) => (kinds.get(o.kind) || 0) < cap2 && (texts.get(o.text) || 0) < 2
      ) || options.find((o) => (texts.get(o.text) || 0) < 2) || options[options.length - 1];
      kinds.set(pick2.kind, (kinds.get(pick2.kind) || 0) + 1);
      texts.set(pick2.text, (texts.get(pick2.text) || 0) + 1);
      return pick2;
    });
  }
  function scoreScene(ctx, s, signals) {
    const t = tasteOf(ctx, s, signals);
    const m = momentumFor(ctx, s);
    const f = freshnessFor(ctx, s);
    return { scene: s, t, m, f, base: t.value + m.value + f.value };
  }
  function rankedScenes(ctx, signals, keep = () => true) {
    return ctx.db.owned.filter((s) => allowed(ctx, s) && keep(s)).map((s) => scoreScene(ctx, s, signals)).sort((a, b) => b.base - a.base);
  }
  var reasonFor = (ctx, x) => reasonOptions(ctx, { ...x, kind: "main" })[0].text;
  function computeForYou(ctx, signals) {
    const { M } = ctx;
    const scored = rankedScenes(ctx, signals);
    const loved = (x) => (M.rating(x.scene) ?? 0) >= 90 || M.rating(x.scene) == null && (behaviourOf(x.scene)?.score ?? 0) >= 0.6;
    const forgotten = scored.filter((x) => x.f.kind === "long" && loved(x)).sort((a, b) => b.t.value + b.f.value - (a.t.value + a.f.value));
    const nearmiss = scored.filter(
      (x) => M.rating(x.scene) == null && barelyPlayed(x.scene) && x.t.value > -0.6 && x.t.value < 0.2
    );
    const picked = [];
    const count2 = /* @__PURE__ */ new Map();
    const capOk = (s) => s.performers.every((p) => (count2.get(p.id) || 0) < FY.perPerformer);
    const varietyOf = (s) => -0.15 * picked.filter(
      (it) => it.scene.performers.some((p) => s.performers.some((q) => q.id === p.id))
    ).length;
    const isPicked = (s) => picked.some((it) => it.scene.id === s.id);
    const take = (x, kind, relaxed) => {
      const it = { ...x, kind, variety: varietyOf(x.scene), relaxed: !!relaxed };
      picked.push(it);
      for (const p of x.scene.performers)
        count2.set(p.id, (count2.get(p.id) || 0) + 1);
    };
    const bestMain = (relax) => {
      let best = null;
      for (const x of scored) {
        if (isPicked(x.scene) || !relax && !capOk(x.scene)) continue;
        const v = x.base + varietyOf(x.scene);
        if (!best || v > best.v) best = { x, v };
      }
      return best?.x;
    };
    for (let i = 0; i < FY.size; i++) {
      const ek = FY.explore[i];
      if (ek) {
        const pools = ek === "forgotten" ? [forgotten, nearmiss] : [nearmiss, forgotten];
        let done = false;
        for (const pool of pools) {
          const x2 = pool.find(
            (y) => !isPicked(y.scene) && capOk(y.scene) && scored.indexOf(y) >= FY.size - 2
          );
          if (x2) {
            take(x2, pool === forgotten ? "forgotten" : "nearmiss");
            done = true;
            break;
          }
        }
        if (done) continue;
      }
      const x = bestMain(false) || bestMain(true);
      if (!x) break;
      take(x, "main", !capOk(x.scene));
    }
    const mains = picked.filter((it) => it.kind === "main");
    const cut = mains.length ? Math.min(...mains.map((it) => it.base + it.variety)) : 0;
    const items = picked.map((it, i) => {
      const exploration = it.kind === "main" ? 0 : Math.max(0, cut - (it.base + it.variety));
      const item = {
        scene: it.scene,
        kind: it.kind,
        parts: {
          taste: r2(it.t.value),
          momentum: r2(it.m.value),
          freshness: r2(it.f.value),
          variety: r2(it.variety),
          exploration: r2(exploration)
        },
        feedback: r2(it.t.feedback),
        total: r2(it.base + it.variety + exploration),
        slot: i + 1,
        momentumSource: it.m.source ? describeSource(it.m.source) : null,
        freshKind: it.f.kind
      };
      item.key = it.m.source?.kind === "performer" ? "p:" + it.m.source.p.id : null;
      return item;
    });
    const reasons = assignReasons(
      ctx,
      picked.map((it, i) => ({ ...it, ...items[i], m: it.m, f: it.f }))
    );
    items.forEach((item, i) => {
      item.reason = reasons[i].text;
      item.reasonKind = reasons[i].kind;
    });
    return items;
  }
  function describeSource(src) {
    if (src.kind === "performer") return `${src.p.name} (${src.f.m.toFixed(2)})`;
    if (src.kind === "studio")
      return `${src.st.name} (lift ${src.f.lift.toFixed(2)})`;
    return `${src.t.name} (lift ${src.f.lift.toFixed(2)})`;
  }
  function followRows(ctx, signals, shownIds) {
    const { db: db2, M, mom } = ctx;
    const shown = new Set(shownIds);
    const rows = [];
    const performers = [...mom.feat].filter(([k, f]) => k[0] === "p" && f.m >= 1.2 && f.scenes.size >= 2).sort((a, b) => b[1].m - a[1].m);
    for (const [k, f] of performers) {
      const p = db2.performers.get(k.slice(2));
      if (!p?.localId || M.performerAffinity(p.id) < 0) continue;
      const own = p.ownedSceneIds.map((id) => db2.scenes.get(id)).filter((s) => allowed(ctx, s) && !shown.has(s.id)).map((s) => scoreScene(ctx, s, signals)).filter((x) => !(x.f.kind === "recent" && x.f.days < 2)).sort((a, b) => b.t.value + b.f.value - (a.t.value + a.f.value)).map((x) => ({
        scene: x.scene,
        reason: followReason(ctx, x),
        key: "p:" + p.id
      }));
      const items = own.slice(0, 12);
      if (items.length >= 4)
        rows.push({
          id: "more-" + p.id,
          title: `More with ${p.name}`,
          items,
          why: `${p.name}: ${f.m.toFixed(2)} decayed plays of ${f.scenes.size} scenes in ${FY.windowDays} days`,
          strength: f.m
        });
      if (rows.length >= 2) break;
    }
    const tags = [...mom.feat].filter(
      ([k, f]) => k[0] === "t" && f.scenes.size >= 3 && f.lift >= 0.33 && (M.fits.content.W.get(k) ?? 0) >= 0
    ).sort((a, b) => b[1].lift - a[1].lift);
    for (const [k, f] of tags.slice(0, 1)) {
      const t = db2.tags.get(k.slice(2));
      const items = db2.owned.filter(
        (s) => s.tags.some((x) => x.id === t.id) && allowed(ctx, s) && !shown.has(s.id)
      ).map((s) => scoreScene(ctx, s, signals)).filter((x) => x.f.kind !== "recent").sort((a, b) => b.t.value + b.f.value - (a.t.value + a.f.value)).slice(0, 12).map((x) => ({ scene: x.scene, reason: followReason(ctx, x), key: k }));
      if (items.length >= 4)
        rows.push({
          id: "back-" + t.id,
          title: `Back to ${t.name}`,
          items,
          why: `${t.name}: in ${f.scenes.size} recent scenes, lift ${f.lift.toFixed(2)} over your library`,
          strength: f.m * f.lift
        });
    }
    return rows.sort((a, b) => b.strength - a.strength).slice(0, 2);
  }
  function followReason(ctx, x) {
    return freshPhrase(ctx, x.scene, x.f) || tastePhrase(ctx, x.scene) || "From your library";
  }
  function newInLibrary(ctx, { keep = () => true, size = FY.size } = {}) {
    const { db: db2 } = ctx;
    const list = db2.owned.filter((s) => allowed(ctx, s) && keep(s) && (ctx.M.rating(s) ?? 60) >= 60).filter((s) => {
      const last = lastPlay(ctx, s);
      return !last || (ctx.now - last) / DAY > 14;
    }).slice().sort((a, b) => b.local.created_at.localeCompare(a.local.created_at));
    const n = list.length || 1;
    const scored = list.map((s, i) => {
      const pop = ctx.hasStashdb ? popularity(db2, s) : null;
      const popScore = pop?.global ? 1 - pop.global / 40 : pop?.performer?.top ? 0.5 * (1 - pop.performer.top / 50) : 0;
      return { s, pop, score: 1 - i / n + 0.8 * popScore };
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, size).map(({ s, pop }) => {
      const added = timeAgo(s.local.created_at, ctx.now);
      const line = pop ? popularityLine(pop) : null;
      return {
        scene: s,
        reason: `Added ${added}` + (line ? ` · ${line}` : ""),
        key: null,
        kind: "fallback"
      };
    });
  }
  var tooSmall = (db2) => db2.owned.length < FY.minLibrary;

  // src/js/model/db.js
  var STASHDB_ENDPOINT = "https://stashdb.org/graphql";
  var STASHDB_PREFIX = "stashdb:";
  var norm = (s) => String(s || "").trim().toLowerCase();
  var sameEndpoint = (a, b) => norm(a).replace(/\/+$/, "") === norm(b).replace(/\/+$/, "");
  var stashIdOn = (ids, endpoint) => (ids || []).find((x) => sameEndpoint(x.endpoint, endpoint))?.stash_id || null;
  var realImage = (path) => path && !/[?&]default=true(&|$)/.test(path) ? path : null;
  var newPerformer = (id, name) => ({
    id,
    name: name || "",
    disambiguation: null,
    stashId: null,
    stashdbGender: null,
    image: null,
    popularSceneIds: null,
    sceneCount: null,
    local: null,
    sceneIds: [],
    ownedSceneIds: [],
    localId: null
  });
  function buildDb(input) {
    const asOf = input.asOf ?? Date.now();
    const sdb = input.stashdb || null;
    const endpoint = sdb?.endpoint || STASHDB_ENDPOINT;
    const scenes = /* @__PURE__ */ new Map();
    const performers = /* @__PURE__ */ new Map();
    const studios = /* @__PURE__ */ new Map();
    const tags = /* @__PURE__ */ new Map();
    const ensurePerformer = (id, name) => {
      if (!performers.has(id)) performers.set(id, newPerformer(id, name));
      return performers.get(id);
    };
    const makeLocal = (rec, row) => {
      rec.name = row.name || rec.name;
      rec.disambiguation = row.disambiguation || null;
      rec.stashId = stashIdOn(row.stash_ids, endpoint);
      rec.image = realImage(row.image_path);
      rec.localId = rec.id;
      rec.local = {
        gender: row.gender ?? null,
        favorite: !!row.favorite,
        rating100: row.rating100 ?? null,
        scene_count: row.scene_count ?? null,
        image_path: row.image_path ?? null,
        stash_ids: row.stash_ids || [],
        custom_fields: row.custom_fields || {}
      };
    };
    for (const row of input.performers || [])
      makeLocal(ensurePerformer(row.id, row.name), row);
    const tagName = new Map((input.tags || []).map((t) => [t.id, t.name]));
    const studioRow = new Map((input.studios || []).map((s) => [s.id, s]));
    const studioOf = (st) => {
      if (!st || st.name != null) return st;
      const row = studioRow.get(st.id);
      if (!row) return { id: st.id, name: "", parent_studio: null };
      const parent = row.parent_studio && studioRow.get(row.parent_studio.id);
      return {
        id: row.id,
        name: row.name,
        parent_studio: parent ? { id: parent.id, name: parent.name } : null
      };
    };
    const creditOf = (p) => {
      if (p.name != null) return p;
      const rec = performers.get(p.id);
      return {
        id: p.id,
        name: rec?.name || "",
        disambiguation: rec?.disambiguation || null,
        gender: rec?.local?.gender ?? null,
        favorite: rec?.local?.favorite ?? false,
        image_path: rec?.local?.image_path ?? null
      };
    };
    const tagOf = (t) => t.name != null ? t : { id: t.id, name: tagName.get(t.id) || "" };
    const owned = [];
    for (const row of input.scenes || []) {
      const st = studioOf(row.studio);
      const credits = (row.performers || []).map(creditOf);
      const rowTags = (row.tags || []).map(tagOf);
      owned.push({
        id: row.id,
        title: row.title || "",
        date: row.date || null,
        duration: row.files?.[0]?.duration ?? null,
        width: row.files?.[0]?.width || null,
        height: row.files?.[0]?.height || null,
        audioOnly: row.files?.[0]?.video_codec === "",
        hasVideo: !!row.files?.[0] && row.files[0].video_codec !== "" && row.files[0].width !== 0,
        image: row.paths?.screenshot || null,
        studio: st ? {
          id: st.id,
          name: st.name,
          parent: st.parent_studio ? { id: st.parent_studio.id, name: st.parent_studio.name } : null
        } : null,
        performers: credits.map((p) => ({
          id: p.id,
          name: p.name,
          gender: p.gender ?? null
        })),
        tags: rowTags.map((t) => ({ id: t.id, name: t.name })),
        owned: true,
        local: {
          rating100: row.rating100 ?? null,
          created_at: row.created_at,
          play_count: row.play_count || 0,
          play_duration: row.play_duration || 0,
          play_history: row.play_history || [],
          o_counter: row.o_counter || 0,
          stash_ids: row.stash_ids || [],
          custom_fields: row.custom_fields || {}
        },
        localId: row.id,
        stashId: stashIdOn(row.stash_ids, endpoint),
        heldBy: null,
        globalPopularityRank: null
      });
      for (const p of credits) {
        const rec = ensurePerformer(p.id, p.name);
        if (!rec.local) makeLocal(rec, { ...p, rating100: null, stash_ids: [] });
      }
      for (const t of rowTags)
        if (!tags.has(t.id)) tags.set(t.id, { id: t.id, name: t.name });
    }
    owned.sort(
      (a, b) => String(a.local.created_at).localeCompare(String(b.local.created_at)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
    for (const s of owned) scenes.set(s.id, s);
    const map = sdb ? stashdbMapping({ owned, performers, tags, endpoint }) : null;
    if (sdb) addStashdbScenes(sdb, map, { scenes, performers });
    const ensureStudio = (id, name, parentId) => {
      let st = studios.get(id);
      if (!st) {
        st = {
          id,
          name,
          parentId: parentId || null,
          popularSceneIds: null,
          sceneIds: [],
          ownedSceneIds: [],
          childIds: /* @__PURE__ */ new Set(),
          localId: null
        };
        studios.set(id, st);
      }
      return st;
    };
    for (const s of scenes.values()) {
      for (const p of s.performers) {
        const rec = ensurePerformer(p.id, p.name);
        rec.sceneIds.push(s.id);
        if (s.owned) rec.ownedSceneIds.push(s.id);
      }
      if (!s.studio) continue;
      const parent = s.studio.parent;
      const ps = parent ? ensureStudio(parent.id, parent.name, null) : null;
      const st = ensureStudio(s.studio.id, s.studio.name, parent?.id);
      if (ps) ps.childIds.add(st.id);
      for (const x of ps ? [st, ps] : [st]) {
        x.sceneIds.push(s.id);
        if (s.owned) {
          x.ownedSceneIds.push(s.id);
          x.localId = x.id;
        }
      }
    }
    if (sdb) {
      for (const row of sdb.performers || []) {
        const rec = ensurePerformer(map.performerId(row.id), row.name);
        rec.stashId = row.id;
        rec.stashdbGender = row.gender ?? rec.stashdbGender;
        if (!rec.local) {
          rec.disambiguation = row.disambiguation || rec.disambiguation;
          rec.image = row.image || rec.image;
        }
        if (row.popularSceneIds)
          rec.popularSceneIds = row.popularSceneIds.map(map.sceneId);
        if (row.sceneCount != null) rec.sceneCount = row.sceneCount;
      }
      for (const row of sdb.studios || []) {
        const ref = map.studio(row);
        const st = ensureStudio(ref.id, ref.name, ref.parent?.id);
        if (row.popularSceneIds)
          st.popularSceneIds = row.popularSceneIds.map(map.sceneId);
      }
    }
    const localPerformers = [...performers.values()].filter((p) => p.local);
    for (const p of localPerformers)
      if (p.local.scene_count == null)
        p.local.scene_count = p.ownedSceneIds.length;
    markRatingSources(
      localPerformers,
      (p) => p.local,
      (p) => p.local.gender
    );
    markRatingSources(owned, (s) => s.local);
    localPerformers.sort(
      (a, b) => b.local.scene_count - a.local.scene_count || a.name.localeCompare(b.name)
    );
    const localStudios = [...studios.values()].filter(
      (st) => st.ownedSceneIds.length
    );
    localStudios.sort((a, b) => a.name.localeCompare(b.name));
    const localTagCounts = /* @__PURE__ */ new Map();
    for (const s of owned)
      for (const t of s.tags)
        localTagCounts.set(t.id, (localTagCounts.get(t.id) || 0) + 1);
    const performerRank = /* @__PURE__ */ new Map();
    for (const p of performers.values()) {
      if (!p.popularSceneIds) continue;
      p.popularSceneIds.forEach((sid, i) => {
        if (!performerRank.has(sid)) performerRank.set(sid, []);
        performerRank.get(sid).push({ performerId: p.id, rank: i + 1 });
      });
    }
    const studioRank = /* @__PURE__ */ new Map();
    for (const st of studios.values()) {
      if (!st.popularSceneIds) continue;
      st.popularSceneIds.forEach((sid, i) => {
        if (!studioRank.has(sid))
          studioRank.set(sid, { studioId: st.id, rank: i + 1 });
      });
    }
    return {
      asOf,
      hasStashdb: !!sdb,
      totalStashdbScenes: sdb?.totalScenes ?? null,
      scenes,
      owned,
      performers,
      localPerformers,
      studios,
      localStudios,
      tags,
      localTagCounts,
      performerRank,
      studioRank,
      favoritePerformerIds: new Set(
        localPerformers.filter((p) => p.local.favorite).map((p) => p.id)
      )
    };
  }
  function stashdbMapping({ owned, performers, tags, endpoint }) {
    const sceneBy = /* @__PURE__ */ new Map();
    for (const s of owned) {
      const sid = stashIdOn(s.local.stash_ids, endpoint);
      if (sid && !sceneBy.has(sid)) sceneBy.set(sid, s.id);
    }
    const perfBy = /* @__PURE__ */ new Map();
    for (const p of performers.values()) {
      const sid = p.local && stashIdOn(p.local.stash_ids, endpoint);
      if (sid && !perfBy.has(sid)) perfBy.set(sid, p.id);
    }
    const studioBy = /* @__PURE__ */ new Map();
    for (const s of owned) {
      if (!s.studio) continue;
      const key = norm(s.studio.name);
      if (!studioBy.has(key)) studioBy.set(key, s.studio);
      const parent = s.studio.parent;
      if (parent && !studioBy.has(norm(parent.name)))
        studioBy.set(norm(parent.name), { ...parent, parent: null });
    }
    const studioRef = (ref) => {
      if (!ref) return null;
      const lib = studioBy.get(norm(ref.name));
      if (lib) return { id: lib.id, name: lib.name, parent: lib.parent };
      const parent = ref.parent ? studioRef({ ...ref.parent, parent: null }) : null;
      return {
        id: STASHDB_PREFIX + ref.id,
        name: ref.name,
        parent: parent ? { id: parent.id, name: parent.name } : null
      };
    };
    const tagBy = /* @__PURE__ */ new Map();
    for (const t of tags.values())
      if (!tagBy.has(norm(t.name))) tagBy.set(norm(t.name), t);
    return {
      sceneId: (id) => sceneBy.get(id) || STASHDB_PREFIX + id,
      performerId: (id) => perfBy.get(id) || STASHDB_PREFIX + id,
      studio: studioRef,
      tag: (t) => {
        const lib = tagBy.get(norm(t.name));
        if (lib) return lib;
        const id = STASHDB_PREFIX + t.id;
        if (!tags.has(id)) tags.set(id, { id, name: t.name });
        return tags.get(id);
      }
    };
  }
  function addStashdbScenes(sdb, map, { scenes, performers }) {
    for (const row of sdb.scenes || []) {
      const id = map.sceneId(row.id);
      const mine = scenes.get(id);
      if (mine?.owned) {
        if (row.heldBy != null) mine.heldBy = row.heldBy;
        if (row.globalPopularityRank != null)
          mine.globalPopularityRank = row.globalPopularityRank;
        mine.stashId = row.id;
        continue;
      }
      if (mine) continue;
      const credits = (row.performers || []).map((p) => {
        const pid = map.performerId(p.id);
        let rec = performers.get(pid);
        if (!rec) {
          rec = newPerformer(pid, p.name);
          rec.disambiguation = p.disambiguation || null;
          rec.stashId = p.id;
          rec.stashdbGender = p.gender ?? null;
          performers.set(pid, rec);
        }
        return {
          id: pid,
          name: rec.name || p.name,
          gender: (rec.local ? rec.local.gender : p.gender ?? null) ?? null
        };
      });
      const seen = /* @__PURE__ */ new Set();
      scenes.set(id, {
        id,
        title: row.title || "",
        date: row.date || null,
        duration: row.duration ?? null,
        image: row.image || null,
        studio: map.studio(row.studio),
        performers: credits,
        tags: (row.tags || []).map(map.tag).filter((t) => !seen.has(t.id) && seen.add(t.id)),
        owned: false,
        local: null,
        localId: null,
        stashId: row.id,
        heldBy: row.heldBy ?? null,
        globalPopularityRank: row.globalPopularityRank ?? null
      });
    }
  }

  // src/js/stashdb/queries.js
  function isStashdbEndpoint(endpoint) {
    try {
      return new URL(endpoint).hostname.toLowerCase() === "stashdb.org";
    } catch {
      return false;
    }
  }
  var stashdbIdOf = (stashIds) => (stashIds || []).find((x) => isStashdbEndpoint(x?.endpoint))?.stash_id || null;
  function stashdbPage(endpoint, kind, id) {
    let origin = "https://stashdb.org";
    try {
      origin = new URL(endpoint).origin;
    } catch {
    }
    return `${origin}/${kind}/${encodeURIComponent(id)}`;
  }
  var STASHBOX_NAME = "StashDB";
  function freeName(boxes) {
    const taken = new Set(boxes.map((b) => b.name));
    for (let n = 1; ; n++) {
      const name = n === 1 ? STASHBOX_NAME : `${STASHBOX_NAME} ${n}`;
      if (!taken.has(name)) return name;
    }
  }
  function withStashdbKey(boxes, apiKey) {
    const list = boxes.map((b) => ({
      endpoint: b.endpoint,
      api_key: b.api_key,
      name: b.name,
      max_requests_per_minute: b.max_requests_per_minute
    }));
    const i = list.findIndex((b) => isStashdbEndpoint(b.endpoint));
    if (i >= 0) {
      list[i] = { ...list[i], api_key: apiKey };
      return { boxes: list, endpoint: list[i].endpoint };
    }
    list.push({
      endpoint: STASHDB_ENDPOINT,
      api_key: apiKey,
      name: freeName(list)
    });
    return { boxes: list, endpoint: STASHDB_ENDPOINT };
  }
  var PERFORMER_SCENES = 100;
  var STUDIO_SCENES = 40;
  var SCENE_BATCH = 25;
  var SCENE_FIELDS = `
  fragment CherryPickStashdbScene on Scene {
    id
    title
    release_date
    duration
    images { url width height }
    studio { id name parent { id name } }
    performers { performer { id name disambiguation gender } }
    tags { id name }
    urls { url site { name category { name } } }
  }
`;
  var SCENE_QUERY = `
  query CherryPickStashdbSceneQuery($input: SceneQueryInput!) {
    queryScenes(input: $input) {
      count
      scenes { ...CherryPickStashdbScene }
    }
  }
  ${SCENE_FIELDS}
`;
  var byPopularity = (filter, perPage) => ({
    input: {
      ...filter,
      sort: "POPULARITY",
      direction: "DESC",
      page: 1,
      per_page: perPage
    }
  });
  var performerScenesVariables = (id) => byPopularity(
    { performers: { value: [id], modifier: "INCLUDES" } },
    PERFORMER_SCENES
  );
  var studioScenesVariables = (id) => byPopularity(
    { studios: { value: [id], modifier: "INCLUDES" } },
    STUDIO_SCENES
  );
  function scenesByIdQuery(n) {
    const vars = Array.from({ length: n }, (_, i) => `$s${i}: ID!`).join(", ");
    const fields = Array.from(
      { length: n },
      (_, i) => `s${i}: findScene(id: $s${i}) { ...CherryPickStashdbScene fingerprints { algorithm submissions } }`
    ).join("\n    ");
    return `
  query CherryPickStashdbScenes(${vars}) {
    ${fields}
  }
  ${SCENE_FIELDS}
`;
  }
  var scenesByIdVariables = (ids) => Object.fromEntries(ids.map((id, i) => [`s${i}`, id]));
  function heldByOf(fingerprints) {
    if (!fingerprints?.length) return null;
    const sums = {};
    for (const f of fingerprints)
      sums[f.algorithm] = (sums[f.algorithm] || 0) + (f.submissions || 0);
    const n = sums.OSHASH ?? Math.max(...Object.values(sums));
    return n > 0 ? n : null;
  }
  function imageOf(images) {
    const list = (images || []).filter((i) => i?.url);
    const wide = list.find((i) => !i.height || i.width >= i.height);
    return (wide || list[0])?.url || null;
  }
  var TRACKING = /^(utm_\w*|ref|refid|referrer|aff\w*|nats|ats|campaign\w*|track\w*|click\w*|coupon\w*|promo\w*|partner\w*|source|src|fbclid|gclid)$/i;
  var STORE_CATEGORY = "Content distribution platforms";
  var ARCHIVE = /(^|\.)(archive\.org|archive\.(is|ph|today))$/i;
  function cleanUrl(raw) {
    try {
      const url = new URL(raw);
      if (!/^https?:$/.test(url.protocol) || ARCHIVE.test(url.hostname))
        return null;
      for (const k of [...url.searchParams.keys()])
        if (TRACKING.test(k)) url.searchParams.delete(k);
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  }
  function storeLink(urls) {
    const links = (urls || []).map((u) => ({
      site: u?.site?.name,
      category: u?.site?.category?.name,
      url: cleanUrl(u?.url)
    })).filter((u) => u.url && u.site);
    const link = links.find((u) => u.category === STORE_CATEGORY) || links.find((u) => /^studio$/i.test(u.site));
    return link ? { url: link.url, site: link.site } : null;
  }
  var storeOf = (scene) => scene?.store || (scene?.studioUrl ? { url: scene.studioUrl, site: "Studio" } : null);
  function sceneFromApi(row) {
    const st = row.studio;
    const scene = {
      id: row.id,
      title: row.title || "",
      date: row.release_date || row.date || null,
      duration: row.duration ?? null,
      image: imageOf(row.images),
      studio: st ? {
        id: st.id,
        name: st.name,
        parent: st.parent ? { id: st.parent.id, name: st.parent.name } : null
      } : null,
      performers: (row.performers || []).map((a) => a?.performer).filter(Boolean).map((p) => ({
        id: p.id,
        name: p.name,
        gender: p.gender ?? null,
        disambiguation: p.disambiguation || null
      })),
      tags: (row.tags || []).map((t) => ({ id: t.id, name: t.name }))
    };
    const store2 = storeLink(row.urls);
    if (store2) scene.store = store2;
    if (row.fingerprints) scene.heldBy = heldByOf(row.fingerprints);
    return scene;
  }
  function performerPart(id, result) {
    const scenes = (result?.scenes || []).map(sceneFromApi);
    const credit = scenes.flatMap((s) => s.performers).find((p) => p.id === id);
    const performer = {
      id,
      sceneCount: result?.count ?? scenes.length,
      popularSceneIds: scenes.map((s) => s.id)
    };
    if (credit) {
      performer.name = credit.name;
      performer.gender = credit.gender;
      performer.disambiguation = credit.disambiguation;
    }
    return { performers: [performer], scenes };
  }
  function studioPart(id, result) {
    const scenes = (result?.scenes || []).map(sceneFromApi);
    const own = scenes.find((s) => s.studio?.id === id)?.studio;
    if (!own) return { scenes };
    return {
      studios: [
        {
          id,
          name: own.name,
          parent: own.parent,
          popularSceneIds: scenes.map((s) => s.id)
        }
      ],
      scenes
    };
  }

  // src/js/runtime/app.js
  var docs = /* @__PURE__ */ new Map();
  var doc = (text) => {
    if (!docs.has(text)) docs.set(text, gql(text));
    return docs.get(text);
  };
  var run = (text, variables) => query(doc(text), variables, "no-cache");
  var runMutation = (text, variables) => mutate(doc(text), variables);
  var store = createStore({
    ...fromConfig(null),
    configLoaded: false,
    // the library as Stash returned it, and when
    library: null,
    // the StashDB stash-box from Stash's settings, if any: { endpoint, apiKey }
    stashdb: null,
    // what the StashDB layer fetched (buildDb's stashdb input), and the state
    // of each page's lookups (stashdb/layer.js)
    stashdbData: null,
    stashdbLookups: {},
    // For you's row signals (tier 3)
    signals: { ...EMPTY_SIGNALS, ...local.get(KEYS.signals) || {} },
    // A full read of the library, page by page ({ kind, n, of }), so For
    // you's first build can say how far it is. It stays null when the page
    // starts from the browser's copy of the library.
    loadProgress: null,
    // session only
    watching: false,
    // Watch This's visit: the pick on screen, the visit's skips and whether
    // the pick was started (runtime/watchThis.js)
    watchVisit: null,
    dialog: null,
    visit: 0,
    recentHidden: [],
    notice: null,
    error: null
  });
  var readPluginMap = async () => {
    const { configuration } = await run(CONFIGURATION);
    return configuration.plugins?.[PLUGIN_ID] ?? null;
  };
  var unsyncedMap = null;
  function syncStashCache() {
    if (!unsyncedMap) return;
    const map = unsyncedMap;
    unsyncedMap = null;
    try {
      client().cache.updateQuery(
        { query: GQL.ConfigurationDocument },
        (data) => data?.configuration ? {
          ...data,
          configuration: {
            ...data.configuration,
            plugins: { ...data.configuration.plugins, [PLUGIN_ID]: map }
          }
        } : data
      );
    } catch (e) {
      console.warn(`${PLUGIN_ID}: refreshing Stash's configuration`, e);
      utils.StashService.evictQueries(client().cache, [GQL.ConfigurationDocument]);
    }
  }
  async function writePluginMap(map) {
    await runMutation(CONFIGURE_PLUGIN, { plugin_id: PLUGIN_ID, input: map });
    unsyncedMap = map;
    if (inSettings()) syncStashCache();
  }
  var tier1 = createTier1({
    read: readPluginMap,
    write: writePluginMap,
    mirror: {
      get: () => local.get(KEYS.mirror),
      set: (map) => local.set(KEYS.mirror, map),
      del: () => local.del(KEYS.mirror)
    },
    settingsOpen: () => inSettings()
  });
  var WRITE_DELAY_MS = 1e3;
  var SNOOZE_DELAY_MS = 5e3;
  var unsaved = /* @__PURE__ */ new Set();
  var unsavedSettings = /* @__PURE__ */ new Set();
  var saveTimer = null;
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!unsaved.size && !unsavedSettings.size) return Promise.resolve();
    const own = [...unsavedSettings];
    const keys2 = [...unsaved, ...own];
    unsaved.clear();
    unsavedSettings.clear();
    return tier1.save(toConfig(store.get()), keys2, own).catch(reportError);
  }
  function changeSettings(changes2) {
    store.set((s) => ({ settings: { ...s.settings, ...changes2 } }));
    Object.keys(changes2).forEach((k) => unsavedSettings.add(k));
    return saveNow();
  }
  function persist(next, prev) {
    if (!next.configLoaded || !prev.configLoaded || next === prev) return;
    const keys2 = [];
    for (const [k, cfg] of Object.entries(STATE_TO_CONFIG))
      if (prev[k] !== next[k]) keys2.push(...cfg);
    if (keys2.length) {
      tier1.stage(toConfig(next), keys2);
      keys2.forEach((k) => unsaved.add(k));
      clearTimeout(saveTimer);
      const onlySnoozes = !unsavedSettings.size && [...unsaved].every((k) => k === "snoozes");
      saveTimer = setTimeout(
        saveNow,
        onlySnoozes ? SNOOZE_DELAY_MS : WRITE_DELAY_MS
      );
    }
    if (prev.signals !== next.signals) local.set(KEYS.signals, next.signals);
  }
  function cancelWrites() {
    clearTimeout(saveTimer);
    saveTimer = null;
    unsaved.clear();
    unsavedSettings.clear();
  }
  var leaving = false;
  function reportError(e) {
    if (leaving) return;
    console.error(`${PLUGIN_ID}:`, e);
    store.set({ error: String(e?.message || e) });
  }
  async function loadConfig() {
    const { configuration } = await run(CONFIGURATION);
    const box = (configuration.general.stashBoxes || []).find(
      (b) => isStashdbEndpoint(b.endpoint)
    );
    const { map, restored } = await tier1.load();
    store.set({
      ...fromConfig(map),
      configLoaded: true,
      stashdb: box?.api_key ? { endpoint: box.endpoint, apiKey: box.api_key } : null
    });
    if (restored) {
      await tier1.save(toConfig(store.get()), Object.keys(toConfig(store.get())));
      store.set({ notice: { kind: "restored", restored } });
    }
    const auto = await autoApplyNow(map, configuration.plugins);
    if (auto != null)
      store.set((s) => ({
        settings: { ...s.settings, autoApply: auto },
        autoApplyDefault: auto
      }));
    const missing = SETTING_KEYS.filter((k) => map?.[k] == null);
    const moved = auto != null && map?.autoApply != null ? ["autoApply"] : [];
    const keys2 = [
      ...missing,
      ...moved,
      ...auto != null ? ["autoApplyDefault"] : []
    ];
    if (keys2.length) await tier1.save(toConfig(store.get()), keys2, moved);
  }
  async function autoApplyNow(map, configs) {
    try {
      const { plugins } = await run(PLUGINS);
      return autoApplyToWrite({
        value: map?.autoApply,
        wrote: store.get().autoApplyDefault ?? null,
        managed: ratingManagers(plugins, configs).length > 0
      });
    } catch (e) {
      reportError(e);
      return null;
    }
  }
  async function reloadSettings() {
    const map = await readPluginMap();
    store.set({ settings: fromConfig(map).settings });
  }
  var loading = null;
  function refreshLibrary(force = false) {
    if (loading) return loading;
    loading = loadLibrary({
      run,
      cache,
      force,
      current: store.get().library,
      onProgress: (p) => store.set({ loadProgress: p })
    }).then((library) => {
      const cur = store.get().library;
      if (!cur || library.syncedAt !== cur.syncedAt) store.set({ library });
    }).catch(reportError).finally(() => loading = null);
    return loading;
  }
  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    store.subscribe(persist);
    window.addEventListener("beforeunload", () => leaving = true);
    window.addEventListener("pagehide", () => {
      leaving = true;
      saveNow();
    });
    window.addEventListener("pageshow", () => leaving = false);
    onLocation((loc, prev) => {
      if (inSettings(loc)) syncStashCache();
      if (inSettings(prev) && !inSettings(loc)) {
        tier1.flush(toConfig(store.get())).catch(reportError);
        reloadSettings().catch(reportError);
      }
      store.set((s) => ({
        watching: false,
        visit: onFrontPage(loc) ? s.visit + 1 : s.visit,
        recentHidden: onFrontPage(loc) ? [] : s.recentHidden
      }));
      const lib = store.get().library;
      if (onFrontPage(loc) && lib && Date.now() - Date.parse(lib.syncedAt) > REFRESH_MS)
        refreshLibrary();
    });
    if (onFrontPage()) store.set((s) => ({ visit: s.visit + 1 }));
    loadConfig().catch(reportError).then(() => refreshLibrary());
  }
  function patchLibrary(list, patches) {
    if (!patches.size) return;
    store.set((s) => {
      if (!s.library) return null;
      const rows = s.library[list].map(
        (r) => patches.has(r.id) ? { ...r, ...patches.get(r.id) } : r
      );
      return { library: { ...s.library, [list]: rows } };
    });
  }
  var patchLibraryPerformer = (id, fields) => patchLibrary("performers", /* @__PURE__ */ new Map([[id, fields]]));
  var patchLibraryScenes = (patches) => patchLibrary("scenes", patches);
  var patchLibraryPerformers = (patches) => patchLibrary("performers", patches);

  // src/js/model/bt.js
  var BT = {
    scale: 0.8,
    // stars per logit
    kScene: 0.38,
    kFeature: 0.12,
    kPerformer: 0.3,
    external: 0.5
    // a match from another plugin, as a share of a pick
  };
  var sigmoid = (x) => 1 / (1 + Math.exp(-x));
  var add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  var tally = (m, id, won, source) => {
    let t = m.get(id);
    if (!t) m.set(id, t = { won: 0, lost: 0, sources: /* @__PURE__ */ new Set() });
    if (won) t.won++;
    else t.lost++;
    t.sources.add(source);
  };
  function replay(decisions, ctx) {
    const sceneOffset = /* @__PURE__ */ new Map();
    const featureDelta = /* @__PURE__ */ new Map();
    const performerOffset = /* @__PURE__ */ new Map();
    const bracketPerformerOffset = /* @__PURE__ */ new Map();
    const wins = /* @__PURE__ */ new Map();
    const losses = /* @__PURE__ */ new Map();
    const sceneMatches = /* @__PURE__ */ new Map();
    const performerMatches = /* @__PURE__ */ new Map();
    const keyCache = /* @__PURE__ */ new Map();
    const keys2 = (id) => {
      if (!keyCache.has(id)) keyCache.set(id, ctx.keys(id));
      return keyCache.get(id);
    };
    const est = (id) => ctx.baseScene(id) + (sceneOffset.get(id) || 0) + keys2(id).reduce((s, k) => s + (featureDelta.get(k) || 0), 0);
    for (const d of decisions) {
      const w = d.source ? BT.external : 1;
      if (d.source) {
        const m = d.kind === "performer" ? performerMatches : sceneMatches;
        tally(m, d.winner, true, d.source);
        tally(m, d.loser, false, d.source);
      } else {
        add(wins, d.winner, 1);
        add(losses, d.loser, 1);
      }
      if (d.kind === "performer") {
        const aff = (id) => ctx.basePerformer(id) + (performerOffset.get(id) || 0);
        const g2 = w * (1 - sigmoid((aff(d.winner) - aff(d.loser)) / BT.scale));
        add(performerOffset, d.winner, BT.kPerformer * g2);
        add(performerOffset, d.loser, -BT.kPerformer * g2);
        if (!d.source) {
          add(bracketPerformerOffset, d.winner, BT.kPerformer * g2);
          add(bracketPerformerOffset, d.loser, -BT.kPerformer * g2);
        }
        continue;
      }
      const g = w * (1 - sigmoid((est(d.winner) - est(d.loser)) / BT.scale));
      add(sceneOffset, d.winner, BT.kScene * g);
      add(sceneOffset, d.loser, -BT.kScene * g);
      const kw = new Set(keys2(d.winner));
      const kl = new Set(keys2(d.loser));
      const onlyW = [...kw].filter((k) => !kl.has(k));
      const onlyL = [...kl].filter((k) => !kw.has(k));
      for (const k of onlyW)
        add(featureDelta, k, BT.kFeature * g / Math.sqrt(onlyW.length));
      for (const k of onlyL)
        add(featureDelta, k, -BT.kFeature * g / Math.sqrt(onlyL.length));
    }
    return {
      sceneOffset,
      featureDelta,
      performerOffset,
      bracketPerformerOffset,
      wins,
      losses,
      sceneMatches,
      performerMatches,
      count: decisions.length
    };
  }

  // src/js/model/matches.js
  var FIELDS = ["performer_record", "scene_record", "xenith_record"];
  var SAME_MATCH_MS = 30 * 1e3;
  var ID = /^\d+$/;
  function entriesOf(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== "string" || !raw) return [];
    try {
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }
  function opponentOf(e) {
    const raw = e.opponentId ?? (typeof e.opponent === "string" ? e.opponent.split(":")[0] : null);
    const id = raw == null ? "" : String(raw).trim();
    return ID.test(id) && id !== "0" ? id : null;
  }
  var sourceOf = (field, e) => field === "xenith_record" ? "Xenith" : "AscRatingAfter" in e ? "Ascension" : "HotOrNot";
  var cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  function entries(db2) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const read = (kind, owner2, fields, inLibrary) => {
      for (const field of FIELDS)
        for (const e of entriesOf(fields?.[field])) {
          if (!e || typeof e !== "object" || typeof e.won !== "boolean") continue;
          const opponent = opponentOf(e);
          const at = Date.parse(e.date);
          if (!opponent || opponent === owner2 || !Number.isFinite(at)) continue;
          if (!inLibrary(opponent)) continue;
          const key = [owner2, opponent, e.won, at].join("|");
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            kind,
            owner: owner2,
            winner: e.won ? owner2 : opponent,
            loser: e.won ? opponent : owner2,
            at,
            source: sourceOf(field, e)
          });
        }
      seen.clear();
    };
    for (const p of db2.localPerformers)
      read(
        "performer",
        p.id,
        p.local.custom_fields,
        (id) => !!db2.performers.get(id)?.local
      );
    for (const s of db2.owned)
      read(
        "clip",
        s.id,
        s.local.custom_fields,
        (id) => !!db2.scenes.get(id)?.owned
      );
    return out;
  }
  function collect(db2) {
    const found = entries(db2).sort(
      (a, b) => a.at - b.at || cmp(a.winner, b.winner) || cmp(a.loser, b.loser) || cmp(a.owner, b.owner)
    );
    const open = /* @__PURE__ */ new Map();
    const out = [];
    for (const f of found) {
      const pair = `${f.kind}|${f.winner}|${f.loser}`;
      const recent = (open.get(pair) || []).filter(
        (m2) => f.at - m2.at <= SAME_MATCH_MS
      );
      open.set(pair, recent);
      const match = recent.find((m2) => !m2.sides.has(f.owner));
      if (match) {
        match.sides.add(f.owner);
        continue;
      }
      const m = { ...f, sides: /* @__PURE__ */ new Set([f.owner]) };
      recent.push(m);
      out.push(m);
    }
    return out.map(({ kind, winner, loser, source }) => ({
      kind,
      winner,
      loser,
      source
    }));
  }
  var cache3 = /* @__PURE__ */ new WeakMap();
  function matchDecisions(db2) {
    if (!cache3.has(db2)) cache3.set(db2, collect(db2));
    return cache3.get(db2);
  }
  var sourcesText = (sources) => andList([...sources].sort());

  // src/js/model/index.js
  var NI_PENALTY = 0.18;
  var FAVOURITE_BONUS = 0.15;
  var PERFORMER_RATING_WEIGHT = 0.3;
  var fmt1 = fmtStars;
  function featureStats(db2, overrides, skip2, rate) {
    const stats = /* @__PURE__ */ new Map();
    const bump = (k, scene, r, b) => {
      let st = stats.get(k);
      if (!st)
        stats.set(
          k,
          st = { n: 0, sum: 0, watched: 0, rewatched: 0, through: 0 }
        );
      if (r != null) {
        st.n++;
        st.sum += r / 20;
      }
      if (b) {
        st.watched++;
        if (b.rewatchDays >= 1) st.rewatched++;
        if (b.watchThrough >= 0.9) st.through++;
      }
    };
    for (const s of db2.owned) {
      if (skip2.has(s.id)) continue;
      const r = rate(s, overrides);
      const b = behaviourOf(s);
      for (const [k] of sceneFeatures(s)) bump(k, s, r, b);
    }
    for (const st of stats.values()) st.mean = st.n ? st.sum / st.n : null;
    return stats;
  }
  function createEngine(db2, shared = {}) {
    const cache4 = shared.fits || {};
    const deferCv = !!shared.deferCv;
    function fits(overrides, skip2 = /* @__PURE__ */ new Set(), rate = ownRating) {
      const key = JSON.stringify(overrides || {}) + "|" + [...skip2].sort().join(",") + "|" + (rate === ownRating ? "own" : "all");
      if (cache4.key === key) return cache4.fits;
      const { rated, watchedUnrated } = buildSamples(db2, overrides, skip2, rate);
      const f = {
        rated,
        watchedUnrated,
        full: fit(rated, watchedUnrated, { ...PARAMS, useBehaviour: true }),
        content: fit(rated, watchedUnrated, { ...PARAMS, useBehaviour: false }),
        cv: deferCv ? rated.length >= MIN_RATED ? shared.provisionalCv || null : null : crossValidate(rated, watchedUnrated, PARAMS),
        cvPending: deferCv && rated.length >= MIN_RATED,
        stats: featureStats(db2, overrides, skip2, rate)
      };
      cache4.key = key;
      cache4.fits = f;
      return f;
    }
    function* finishCv() {
      const f = cache4.fits;
      if (!f?.cvPending) return null;
      const cv = yield* crossValidateSteps(f.rated, f.watchedUnrated, PARAMS);
      if (cache4.fits !== f) return null;
      cache4.fits = { ...f, cv, cvPending: false };
      return cv;
    }
    function compute(input) {
      const overrides = input.overrides || {};
      const performerOverrides = input.performerOverrides || {};
      const dontLearn = new Set(input.dontLearn || []);
      const learnAll = !!input.learnFromRankings;
      const rate = learnAll ? sceneRating : ownRating;
      const F = fits(overrides, dontLearn, rate);
      const stashPerformerRating = (id) => {
        if (Object.prototype.hasOwnProperty.call(performerOverrides, id))
          return performerOverrides[id];
        return db2.performers.get(id)?.local?.rating100 ?? null;
      };
      const ratingSource = (kind, id) => {
        const over = kind === "performer" ? performerOverrides : overrides;
        if (Object.prototype.hasOwnProperty.call(over, id)) return null;
        const rec = kind === "performer" ? db2.performers.get(id) : db2.scenes.get(id);
        return rec?.local?.ratingSource ?? null;
      };
      const performerRating = (id) => !learnAll && ratingSource("performer", id) ? null : stashPerformerRating(id);
      const sceneTaste = (id) => F.content.W.get("p:" + id) ?? 0;
      const penalty = /* @__PURE__ */ new Map();
      for (const ni of input.notInterested || [])
        if (ni.key) penalty.set(ni.key, (penalty.get(ni.key) || 0) - NI_PENALTY);
      const rating = (scene) => rate(scene, overrides);
      const stashRating = (scene) => sceneRating(scene, overrides);
      const modelFor = (scene) => scene.owned && behaviourOf(scene) ? F.full : F.content;
      const baseCache = /* @__PURE__ */ new Map();
      const baseScene = (id) => {
        if (!baseCache.has(id)) {
          const s = db2.scenes.get(id);
          const r = rating(s);
          baseCache.set(
            id,
            r != null ? r / 20 : predict(modelFor(s), s, { penalty }).value
          );
        }
        return baseCache.get(id);
      };
      const basePerformer = (id) => {
        const r = performerRating(id);
        return sceneTaste(id) + (r != null ? PERFORMER_RATING_WEIGHT * (r / 20 - 3.5) : 0) + (penalty.get("p:" + id) || 0) + (db2.favoritePerformerIds.has(id) ? FAVOURITE_BONUS : 0);
      };
      const btKeys = (id) => sceneFeatures(db2.scenes.get(id)).map(([k]) => k).filter((k) => k[0] === "p" || k[0] === "s");
      const learns = (id) => !!db2.scenes.get(id)?.owned && !dontLearn.has(id);
      const decisions = [
        ...input.learnFromMatches ? matchDecisions(db2) : [],
        ...input.decisions || []
      ].filter(
        (d) => d.kind === "performer" || learns(d.winner) && learns(d.loser)
      );
      const bt = replay(decisions, { baseScene, keys: btKeys, basePerformer });
      const fromMatches = decisions.filter((d) => d.source);
      const matches2 = {
        count: fromMatches.length,
        sources: [...new Set(fromMatches.map((d) => d.source))].sort()
      };
      const extraFor = (scene) => ({
        penalty,
        featureDelta: bt.featureDelta,
        performerOffset: bt.performerOffset,
        sceneOffset: bt.sceneOffset.get(scene.id) || 0
      });
      const predictions = /* @__PURE__ */ new Map();
      for (const s of db2.scenes.values())
        predictions.set(s.id, predict(modelFor(s), s, extraFor(s)));
      const ratingsToGo = Math.max(0, MIN_RATED - F.rated.length);
      const ratedStars = F.rated.map((x) => x.y);
      const ratedSum = ratedStars.reduce((a, b) => a + b, 0);
      const ratedMean = ratedStars.length ? ratedSum / ratedStars.length : 3;
      const userMean = ratingsToGo ? (ratedSum + ratingsToGo * (F.content.pseudoMean ?? ratedMean)) / MIN_RATED : ratedMean;
      const highShare = ratedStars.length ? ratedStars.filter((y) => y >= 4).length / ratedStars.length : 0;
      const inflated = ratedMean >= 3.6 && highShare >= 0.5;
      const dist = db2.owned.filter((s) => rating(s) == null).map((s) => predictions.get(s.id).value);
      let sorted = null;
      const topShareOf = (v) => {
        if (!dist.length) return 0.5;
        sorted || (sorted = Float64Array.from(dist).sort());
        let lo = 0;
        let hi = sorted.length;
        while (lo < hi) {
          const mid = lo + hi >> 1;
          if (sorted[mid] > v + 1e-9) hi = mid;
          else lo = mid + 1;
        }
        return (sorted.length - lo) / sorted.length;
      };
      const cv = F.cv;
      const gate = !!cv && cv.maeModel < cv.maeBase;
      const estimate = (id) => {
        const s = db2.scenes.get(id);
        const r = rating(s);
        if (r != null)
          return Math.min(
            5,
            Math.max(0.5, r / 20 + (bt.sceneOffset.get(id) || 0))
          );
        return predictions.get(id).value;
      };
      const performerAffinity = (id) => basePerformer(id) + (bt.performerOffset.get(id) || 0);
      const performerSceneStats = (id) => {
        const st = F.stats.get("p:" + id);
        if (st && (st.n || st.watched))
          return { n: st.n, mean: st.mean, watched: st.watched };
        return { n: 0, mean: null, watched: 0 };
      };
      return {
        db: db2,
        overrides,
        performerOverrides,
        dontLearn,
        performerRating,
        stashPerformerRating,
        ratingSource,
        performerSceneStats,
        fits: F,
        cv,
        gate,
        ratingsToGo,
        penalty,
        bt,
        matches: matches2,
        predictions,
        userMean,
        highShare,
        inflated,
        rating,
        stashRating,
        estimate,
        performerAffinity,
        prediction: (id) => predictions.get(id),
        topShare: (v) => topShareOf(v),
        stats: F.stats,
        // positive: explain what speaks for it, even when the score is below average (for picks)
        reason: (id, positive) => reasonFor2(
          db2,
          F,
          bt,
          predictions.get(id),
          db2.scenes.get(id),
          positive ? -Infinity : userMean
        ),
        reasons: (id, positive) => reasonsFor(
          db2,
          F,
          bt,
          predictions.get(id),
          db2.scenes.get(id),
          positive ? -Infinity : userMean
        )
      };
    }
    return { compute, fits, cache: cache4, finishCv };
  }
  function rateMore(M, { short = false } = {}) {
    const n = M?.ratingsToGo;
    if (!n) return null;
    if (n === MIN_RATED) return `Rate ${n} scenes`;
    return `Rate ${n} more` + (short ? "" : ` scene${n === 1 ? "" : "s"}`);
  }
  function unratedByYou(M, scene) {
    if (scene.rating100 == null) return true;
    const s = M.db.scenes.get(scene.id);
    return !!s && M.rating(s) == null && M.stashRating(s) === scene.rating100;
  }
  function badgeLabel(M, value, relativeStyle) {
    const half = Math.round(value * 2) / 2;
    if (!relativeStyle)
      return {
        corner: "~" + fmt1(value),
        line: `likely ${half % 1 ? half.toFixed(1) : half}★ for you`,
        relative: false
      };
    const share = M.topShare(value);
    let short;
    if (share < 0.1) short = "Top 10%";
    else if (share < 0.25) short = "Top 25%";
    else if (share < 0.5) short = "Top half";
    else if (share < 0.75) short = "Lower half";
    else short = "Bottom 25%";
    return {
      corner: short,
      line: `likely ${short.toLowerCase()} for you`,
      relative: true,
      share
    };
  }
  function reasonFor2(db2, F, bt, pred, scene, userMean) {
    return reasonsFor(db2, F, bt, pred, scene, userMean)[0] ?? null;
  }
  function reasonsFor(db2, F, bt, pred, scene, userMean) {
    if (!pred) return [];
    const dir = pred.value >= userMean ? 1 : -1;
    const parts = pred.parts.slice().sort((a, b) => dir * b.value - dir * a.value);
    const out = [];
    for (const part of parts) {
      if (dir * part.value < 0.03) break;
      const text = phrase(db2, F, bt, part, scene, dir);
      if (text && !out.some((o) => o.text === text))
        out.push({ text, key: part.key });
    }
    if (F.rated.length < MIN_RATED) return out;
    out.push({
      text: dir > 0 ? "A lot like scenes you rate well" : "Not much like what you rate well",
      key: null
    });
    return out;
  }
  function phrase(db2, F, bt, part, scene, dir) {
    const k = part.key;
    if (k === "b") {
      const b = part.behaviour;
      if (dir > 0) {
        if (b.rewatchDays >= 1)
          return `You've come back to it on ${b.days} different days`;
        if (b.watchThrough >= 0.9) return "You watched it all the way through";
        return "You keep it playing longer than most";
      }
      return `You stopped about ${Math.max(5, Math.round(b.watchThrough * 100 / 5) * 5)}% of the way in`;
    }
    if (k === "o") {
      const w = bt.wins.get(scene.id) || 0;
      const l = bt.losses.get(scene.id) || 0;
      if (dir > 0 && w)
        return `Won ${w} match${w === 1 ? "" : "es"} in your brackets`;
      if (dir < 0 && l) return "Went out early in a bracket";
      return matchesPhrase(bt.sceneMatches.get(scene.id), dir, "Won", "Lost");
    }
    const id = k.slice(2);
    const st = F.stats.get(k);
    if (k[0] === "p") {
      const p = db2.performers.get(id);
      if (!p) return null;
      const own = bt.bracketPerformerOffset.get(id) || 0;
      const other = (bt.performerOffset.get(id) || 0) - own;
      const learned = Math.abs(F.content.W.get(k) || 0);
      if (part.value && own && Math.abs(own) > learned && Math.abs(own) >= Math.abs(other)) {
        return dir > 0 ? `${p.name} did well in your performer bracket` : `${p.name} went out early in your performer bracket`;
      }
      if (part.value && other * dir > 0 && Math.abs(other) > learned) {
        const text = matchesPhrase(
          bt.performerMatches.get(id),
          dir,
          "won",
          "lost"
        );
        if (text) return `${p.name} ${text}`;
      }
      if (st && st.n >= 2)
        return `You average ${fmt1(st.mean)}★ on ${p.name}'s scenes`;
      if (st && st.n === 1)
        return `You rated ${pronoun(p)} other scene ${fmt1(st.mean)}★`;
      if (st && st.through >= 2 && dir > 0)
        return `You watch ${p.name}'s scenes all the way through`;
      if (!st?.watched) return null;
      return dir > 0 ? `You watch more of ${p.name}'s scenes than most` : `You tend to stop ${p.name}'s scenes early`;
    }
    if (k[0] === "s") {
      const s = db2.studios.get(id);
      if (!s) return null;
      if (st && st.n >= 2)
        return `You average ${fmt1(st.mean)}★ on ${s.name} scenes`;
      if (st && st.rewatched >= 2 && dir > 0)
        return `Same studio as ${st.rewatched} scenes you've watched twice`;
      return null;
    }
    if (k[0] === "t") {
      const t = db2.tags.get(id);
      if (!t || !st || st.n < 3) return null;
      return `Scenes tagged ${t.name} average ${fmt1(st.mean)}★ for you`;
    }
    return null;
  }
  function matchesPhrase(t, dir, won, lost) {
    const n = t ? t.won + t.lost : 0;
    const k = dir > 0 ? t?.won : t?.lost;
    if (!k) return null;
    return `${dir > 0 ? won : lost} ${k} of ${n} match${n === 1 ? "" : "es"} in ${sourcesText(t.sources)}`;
  }
  function blameKey(pred) {
    if (!pred) return null;
    const pos = pred.parts.filter((p) => p.key !== "b" && p.key !== "o").sort((a, b) => b.value - a.value)[0];
    return pos && pos.value > 0 ? pos.key : null;
  }
  function keyLabel(db2, key) {
    if (!key) return null;
    const id = key.slice(2);
    if (key[0] === "p") return db2.performers.get(id)?.name;
    if (key[0] === "s") return db2.studios.get(id)?.name;
    if (key[0] === "t") return "tag " + db2.tags.get(id)?.name;
    return null;
  }

  // src/js/model/brackets.js
  var SIZES = [16, 32, 64];
  var DEFAULT_SIZE = 16;
  var MIN_CLIP_POOL = 4;
  var CHAMPIONS_MIN = 4;
  var eligible = (p) => !!(p.local && p.image && p.local.scene_count >= 1);
  var stashGender = (p) => p.local?.gender ?? null;
  function performerPool(M, opts, genderOf2 = stashGender) {
    return M.db.localPerformers.filter(eligible).filter((p) => genderOf2(p) === opts.gender).filter(
      (p) => opts.pool !== "favorites" || M.db.favoritePerformerIds.has(p.id)
    ).filter(
      (p) => opts.pool !== "filter" || !opts.filterIds || opts.filterIds.has(p.id)
    ).map((p) => p.id);
  }
  function genderless(M, genderOf2 = stashGender) {
    return M.db.localPerformers.filter(
      (p) => p.local.scene_count >= 1 && !genderOf2(p)
    );
  }
  var resolveSize = (pref, n) => SIZES.includes(pref) && n >= pref ? pref : n >= DEFAULT_SIZE ? DEFAULT_SIZE : null;
  function clipSize(n, pref = DEFAULT_SIZE) {
    if (n >= DEFAULT_SIZE) return resolveSize(pref, n);
    if (n < MIN_CLIP_POOL) return null;
    let s = 4;
    while (s < n) s *= 2;
    return s;
  }
  var clipPoolPhrase = (n) => n <= DEFAULT_SIZE ? `the ${n}` : `${DEFAULT_SIZE} of the ${n}`;
  var clipPoolSpread = (n) => n > DEFAULT_SIZE ? ", from likely best to likely worst" : "";
  var clipByes = (n) => n >= MIN_CLIP_POOL && n < DEFAULT_SIZE ? clipSize(n) - n : 0;
  var bracketScenes = (M) => M.db.owned.filter((s) => !s.audioOnly && !M.dontLearn.has(s.id));
  function clipEntrants(M, ids) {
    const unrated = ids.filter((id) => entrantRole(M, "clip", id) !== "anchor");
    return unrated.length >= MIN_CLIP_POOL ? unrated : ids;
  }
  var PROVISIONAL_FIELD = FIELD_PREFIX + "provisional";
  function isProvisional(local2, rating100 = local2?.rating100) {
    const v = local2?.custom_fields?.[PROVISIONAL_FIELD];
    if (rating100 == null || v == null || v === "") return false;
    return Number(v) === rating100;
  }
  var recordOf = (M, kind, id) => kind === "performer" ? M.db.performers.get(id) : M.db.scenes.get(id);
  function stashRatingOf(M, kind, id) {
    if (kind === "performer") return M.stashPerformerRating(id);
    const s = M.db.scenes.get(id);
    return s ? M.stashRating(s) : null;
  }
  function entrantRole(M, kind, id) {
    const source = M.ratingSource(kind, id);
    if (source && source !== "primed") return "ranked";
    const r = stashRatingOf(M, kind, id);
    if (r == null || source === "primed") return "candidate";
    return isProvisional(recordOf(M, kind, id)?.local, r) ? "candidate" : "anchor";
  }
  var SCENE_ANCHOR_MIN = 2;
  function sceneAverage(M, id) {
    let n = 0;
    let sum2 = 0;
    for (const sid of M.db.performers.get(id)?.ownedSceneIds || []) {
      if (M.dontLearn.has(sid) || entrantRole(M, "clip", sid) !== "anchor")
        continue;
      n++;
      sum2 += stashRatingOf(M, "clip", sid);
    }
    return n >= SCENE_ANCHOR_MIN ? Math.round(sum2 / n) : null;
  }
  function sceneAnchorRating(M, id) {
    const r = M.stashPerformerRating(id);
    if (isProvisional(M.db.performers.get(id)?.local, r)) return null;
    return sceneAverage(M, id);
  }
  var strengthOf = (M, kind) => kind === "performer" ? (id) => M.performerAffinity(id) : (id) => M.estimate(id);
  function linearTargets(vals, k) {
    let hi = -Infinity;
    let lo = Infinity;
    for (const v of vals) {
      if (v > hi) hi = v;
      if (v < lo) lo = v;
    }
    return Array.from(
      { length: k },
      (_, i) => k === 1 ? hi : hi - i * (hi - lo) / (k - 1)
    );
  }
  function byRankTargets(vals, k) {
    const sorted = vals.slice().sort((a, b) => b - a);
    return Array.from(
      { length: k },
      (_, i) => sorted[k === 1 ? 0 : Math.round(i * (sorted.length - 1) / (k - 1))]
    );
  }
  function spreadPick(ids, value, k, targetsFor = byRankTargets) {
    if (k >= ids.length) return ids.slice();
    if (k <= 0) return [];
    const vals = ids.map(value);
    const used = new Uint8Array(ids.length);
    const out = [];
    for (const t of targetsFor(vals, k)) {
      let best = -1;
      for (let j = 0; j < ids.length; j++)
        if (!used[j] && (best < 0 || Math.abs(vals[j] - t) < Math.abs(vals[best] - t)))
          best = j;
      used[best] = 1;
      out.push(ids[best]);
    }
    return out;
  }
  var RECENT_BRACKETS = 3;
  function recentEntrants(history, kind, gender = null) {
    return new Set(
      history.filter(
        (b) => b.kind === kind && b.result && !b.champions && (kind !== "performer" || b.gender === gender)
      ).sort((a, b) => (b.finishedAt || "").localeCompare(a.finishedAt || "")).slice(0, RECENT_BRACKETS).flatMap((b) => b.seeds || [])
    );
  }
  function freshFirst(ids, k, recent, pickK) {
    if (!recent?.size) return pickK(ids, k);
    const fresh = ids.filter((id) => !recent.has(id));
    const kf = Math.min(k, fresh.length);
    return [
      ...pickK(fresh, kf),
      ...pickK(
        ids.filter((id) => recent.has(id)),
        k - kf
      )
    ];
  }
  function composeEntrants(M, kind, ids, size, recent = null) {
    const strength = strengthOf(M, kind);
    const byStrength = (a, b) => strength(b) - strength(a);
    const role = { anchor: [], scene: [], candidate: [], ranked: [] };
    const average = /* @__PURE__ */ new Map();
    for (const id of ids) {
      const r = entrantRole(M, kind, id);
      const avg = r === "candidate" && kind === "performer" ? sceneAnchorRating(M, id) : null;
      if (avg != null) average.set(id, avg);
      role[avg != null ? "scene" : r].push(id);
    }
    for (const list of Object.values(role)) list.sort(byStrength);
    const kC = Math.min(role.candidate.length, size);
    const kR = Math.min(role.ranked.length, size - kC);
    const kA = Math.min(role.anchor.length, size - kC - kR);
    const kS = Math.min(role.scene.length, size - kC - kR - kA);
    const rating = (id) => average.has(id) ? average.get(id) : stashRatingOf(M, kind, id);
    const byRating = (a, b) => rating(b) - rating(a) || byStrength(a, b);
    const spread = (list, k) => spreadPick(list.slice().sort(byRating), rating, k, linearTargets);
    const sceneAnchors = spread(role.scene, kS);
    const anchors = [...spread(role.anchor, kA), ...sceneAnchors].sort(byRating);
    return {
      anchors,
      candidates: freshFirst(
        role.candidate,
        kC,
        recent,
        (list, k) => spreadPick(list, strength, k)
      ),
      ranked: freshFirst(role.ranked, kR, recent, (list, k) => list.slice(0, k)),
      ratings: Object.fromEntries(anchors.map((id) => [id, rating(id)])),
      sceneAnchors
    };
  }
  function seedOrder(n) {
    let s = [1];
    while (s.length < n) {
      const m = s.length * 2;
      s = s.flatMap((x) => [x, m + 1 - x]);
    }
    return s;
  }
  function randomFrom(seed) {
    let a = seed >>> 0;
    return () => {
      a = a + 1831565813 >>> 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var evenly = (k, n) => Array.from(
    { length: k },
    (_, i) => k === 1 ? 0 : Math.round(i * (n - 1) / (k - 1))
  );
  function firstRoundSlots(anchors, unknowns, size, now = 0) {
    const n = anchors.length + unknowns.length;
    const matches2 = n - size / 2;
    let byes = size - n;
    const x = Math.min(anchors.length, unknowns.length, matches2);
    const takeA = new Set(evenly(x, anchors.length));
    const takeU = new Set(evenly(x, unknowns.length));
    const pA = anchors.filter((_, i) => takeA.has(i));
    const pU = unknowns.filter((_, i) => takeU.has(i));
    const units = pA.map((a, i) => [a, pU[i]]);
    const restA = anchors.filter((_, i) => !takeA.has(i));
    const restU = unknowns.filter((_, i) => !takeU.has(i));
    for (const list of [restA, restU])
      while (byes > 0 && list.length) {
        units.push([list.shift(), null]);
        byes--;
      }
    const left = [...restU, ...restA];
    const half = left.length / 2;
    for (let i = 0; i < half; i++) units.push([left[i], left[i + half]]);
    const rand = randomFrom(now);
    const slots = [];
    for (const rank of seedOrder(size / 2)) {
      const [p, q] = units[rank - 1];
      if (q && rand() < 0.5) slots.push(q, p);
      else slots.push(p, q);
    }
    return slots;
  }
  function createBracket(M, {
    kind,
    gender = null,
    poolLabel,
    size,
    ids,
    champions = false,
    origin = null,
    recent = null,
    pool = ids,
    now = Date.now()
  }) {
    const strength = strengthOf(M, kind);
    const { anchors, candidates, ranked, ratings, sceneAnchors } = composeEntrants(M, kind, ids, size, recent);
    const unknowns = [...candidates, ...ranked].sort(
      (a, b) => strength(b) - strength(a)
    );
    const slots = firstRoundSlots(anchors, unknowns, size, now);
    const seeds = slots.filter(Boolean);
    return {
      id: "b" + now.toString(36),
      kind,
      gender,
      poolLabel,
      size,
      champions,
      origin,
      seeds,
      slots,
      spread: entrantSpread(M, kind, gender, seeds),
      anchors: ratings,
      sceneAnchors,
      waiting: champions ? [] : waitingIn(M, kind, pool, slots),
      championRating: null,
      decisions: [],
      createdAt: new Date(now).toISOString(),
      finishedAt: null,
      status: "active"
    };
  }
  function roundName(slotsInRound) {
    if (slotsInRound === 2) return "Final";
    if (slotsInRound === 4) return "Semifinals";
    if (slotsInRound === 8) return "Quarterfinals";
    return `Round of ${slotsInRound}`;
  }
  function bracketState(b) {
    let entrants = b.slots ? b.slots.slice() : seedOrder(b.size).map((seed) => b.seeds[seed - 1] || null);
    const rounds = [];
    let di = 0;
    let current3 = null;
    while (entrants.length > 1) {
      const matches2 = [];
      for (let i = 0; i < entrants.length; i += 2)
        matches2.push({
          a: entrants[i],
          b: entrants[i + 1],
          winner: null,
          bye: false
        });
      rounds.push(matches2);
      const first = rounds.length === 1;
      matches2.forEach((m, mi) => {
        if (!m.a || !m.b) {
          if (first) {
            m.winner = m.a || m.b;
            m.bye = true;
          }
          return;
        }
        const d = b.decisions[di];
        if (!current3 && d) {
          m.winner = d.winner;
          di++;
        } else if (!current3) {
          current3 = { round: rounds.length - 1, index: mi, a: m.a, b: m.b };
        }
      });
      entrants = matches2.map((m) => m.winner);
    }
    const loserOf = (m) => m.winner === m.a ? m.b : m.a;
    const done = !current3;
    const n = rounds.length;
    const result = done ? {
      champion: rounds[n - 1][0].winner,
      finalist: loserOf(rounds[n - 1][0]),
      semifinalists: n >= 2 ? rounds[n - 2].map(loserOf).filter(Boolean) : [],
      quarterfinalists: n >= 3 ? rounds[n - 3].map(loserOf).filter(Boolean) : []
    } : null;
    let label = "Finished";
    let roundLabel = null;
    if (current3) {
      const r = rounds[current3.round];
      const real = r.filter((m) => !m.bye);
      const idx = real.indexOf(r[current3.index]);
      roundLabel = roundName(r.length * 2);
      label = real.length > 1 ? `${roundLabel} · match ${idx + 1} of ${real.length}` : roundLabel;
    }
    return {
      rounds,
      current: current3,
      done,
      result,
      played: b.decisions.length,
      totalMatches: b.seeds.length - 1,
      label,
      roundLabel
    };
  }
  function pick(b, winner) {
    const st = bracketState(b);
    if (!st.current) return b;
    const loser = winner === st.current.a ? st.current.b : st.current.a;
    return { ...b, decisions: [...b.decisions, { winner, loser }] };
  }
  function undo(b) {
    if (!b.decisions.length) return b;
    return { ...b, decisions: b.decisions.slice(0, -1) };
  }
  function modelDecisions(b) {
    return [...b.decisions || [], ...b.challenge?.decisions || []].map(
      (d) => ({
        kind: b.kind,
        winner: d.winner,
        loser: d.loser,
        bracket: b.id
      })
    );
  }
  var CHALLENGE_RUNGS = 3;
  var WAITING_KEEP = 12;
  var has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  function ratedIn(M, kind, ids, above = -Infinity) {
    const rating = /* @__PURE__ */ new Map();
    const own = [];
    const scene = [];
    for (const id of ids) {
      const role = entrantRole(M, kind, id);
      const r = role === "anchor" ? stashRatingOf(M, kind, id) : role === "candidate" && kind === "performer" ? sceneAnchorRating(M, id) : null;
      if (r == null || r <= above) continue;
      rating.set(id, r);
      (role === "anchor" ? own : scene).push(id);
    }
    return { own, scene, rating };
  }
  function spreadRated(M, kind, { own, scene, rating }, k) {
    const strength = strengthOf(M, kind);
    const value = (id) => rating.get(id);
    const byRating = (x, y) => value(y) - value(x) || strength(y) - strength(x);
    const spread = (list, n) => spreadPick(list.slice().sort(byRating), value, n, linearTargets);
    const kOwn = Math.min(own.length, k);
    return { own: spread(own, kOwn), scene: spread(scene, k - kOwn) };
  }
  function waitingIn(M, kind, pool, played) {
    const seeds = new Set(played);
    const r = spreadRated(
      M,
      kind,
      ratedIn(
        M,
        kind,
        pool.filter((id) => !seeds.has(id))
      ),
      WAITING_KEEP
    );
    return [...r.own, ...r.scene];
  }
  function challengeFor(M, b, genderOf2 = stashGender) {
    const champ = b.result?.champion;
    const kind = b.kind;
    if (!champ || b.champions || has(b.anchors, champ)) return null;
    if (entrantRole(M, kind, champ) === "anchor") return null;
    const played = new Set(b.seeds);
    const floor = Math.max(-Infinity, ...Object.values(b.anchors || {}));
    const library = (kind === "performer" ? M.db.localPerformers.filter(eligible).filter((p) => genderOf2(p) === b.gender).map((p) => p.id) : bracketScenes(M).map((s) => s.id)).filter((id) => !played.has(id));
    const inLibrary = new Set(library);
    const held = (b.waiting || []).filter((id) => inLibrary.has(id));
    const heldSet = new Set(held);
    const first = spreadRated(
      M,
      kind,
      ratedIn(M, kind, held, floor),
      CHALLENGE_RUNGS
    );
    const n = first.own.length + first.scene.length;
    const rest = spreadRated(
      M,
      kind,
      ratedIn(
        M,
        kind,
        library.filter((id) => !heldSet.has(id)),
        floor
      ),
      CHALLENGE_RUNGS - n
    );
    const sceneRungs = [...first.scene, ...rest.scene];
    const all = [...first.own, ...first.scene, ...rest.own, ...rest.scene];
    if (!all.length) return null;
    const rating = (id) => sceneRungs.includes(id) ? sceneAnchorRating(M, id) : stashRatingOf(M, kind, id);
    const strength = strengthOf(M, kind);
    const rungs = all.sort(
      (x, y) => rating(x) - rating(y) || strength(x) - strength(y)
    );
    return {
      rungs,
      ratings: Object.fromEntries(rungs.map((id) => [id, rating(id)])),
      sceneRungs,
      decisions: []
    };
  }
  function challengeState(b) {
    const c = b?.challenge;
    const champ = b?.result?.champion;
    if (!c || !champ) return null;
    const beaten = [];
    let lostTo = null;
    for (const [i, d] of c.decisions.entries()) {
      if (i >= c.rungs.length) break;
      if (d.winner !== champ) {
        lostTo = c.rungs[i];
        break;
      }
      beaten.push(c.rungs[i]);
    }
    const current3 = lostTo || beaten.length >= c.rungs.length ? null : c.rungs[beaten.length];
    return {
      rungs: c.rungs,
      beaten,
      lostTo,
      current: current3,
      started: c.decisions.length > 0,
      done: !current3,
      won: !lostTo && c.rungs.length > 0 && beaten.length === c.rungs.length,
      skipped: !!c.skipped && !c.decisions.length
    };
  }
  var challengeWon = (b) => !!challengeState(b)?.won;
  function challengePick(b, winner, against = null) {
    const st = challengeState(b);
    if (!st?.current || against != null && against !== st.current) return b;
    const champ = b.result.champion;
    if (winner !== champ && winner !== st.current) return b;
    const loser = winner === champ ? st.current : champ;
    return {
      ...b,
      championRating: null,
      challenge: {
        ...b.challenge,
        skipped: false,
        decisions: [...b.challenge.decisions, { winner, loser }]
      }
    };
  }
  function challengeUndo(b) {
    if (!b.challenge?.decisions.length) return b;
    return {
      ...b,
      challenge: {
        ...b.challenge,
        decisions: b.challenge.decisions.slice(0, -1)
      }
    };
  }
  var skipChallenge = (b, skipped = true) => b.challenge ? { ...b, challenge: { ...b.challenge, skipped } } : b;
  var performerBrackets = (history) => history.filter((b) => b.kind === "performer" && b.result);
  function performerHonours(history) {
    const out = {};
    const bump = (id, k) => {
      if (!id) return;
      out[id] = out[id] || { champion: 0, finalist: 0, challenger: 0 };
      out[id][k]++;
    };
    for (const b of performerBrackets(history)) {
      bump(b.result.champion, "champion");
      bump(b.result.finalist, "finalist");
      if (challengeWon(b)) bump(b.result.champion, "challenger");
    }
    return out;
  }
  function championsOf(history, gender) {
    const seen = /* @__PURE__ */ new Set();
    return performerBrackets(history).filter((b) => !b.champions && b.gender === gender).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).map((b) => b.result.champion).filter((id) => !seen.has(id) && seen.add(id));
  }
  function championsRoundSize(n) {
    if (n < CHAMPIONS_MIN) return 0;
    let s = 4;
    while (s * 2 <= Math.min(n, 16)) s *= 2;
    return s;
  }
  var FIELDS2 = {
    titles: FIELD_PREFIX + "titles",
    // number: brackets won
    best: FIELD_PREFIX + "best_finish",
    // string: champion, final, semifinal, quarterfinal
    last: FIELD_PREFIX + "last_bracket"
    // date: the last bracket they placed in
  };
  var FIELD_TYPES = {
    [FIELDS2.titles]: "number",
    [FIELDS2.best]: "string",
    [FIELDS2.last]: "date"
  };
  var FINISH_ORDER = ["quarterfinal", "semifinal", "final", "champion"];
  var OWN_FIELDS = [...Object.values(FIELDS2), PROVISIONAL_FIELD];
  var ownFieldsOn = (customFields) => OWN_FIELDS.filter((f) => f in (customFields || {}));
  function bracketFieldUpdates(current3, b) {
    if (b.kind !== "performer" || !b.result) return {};
    const r = b.result;
    const date = (b.finishedAt || "").slice(0, 10);
    const placed = [
      [r.champion, "champion"],
      [r.finalist, "final"],
      ...(r.semifinalists || []).map((x) => [x, "semifinal"]),
      ...(r.quarterfinalists || []).map((x) => [x, "quarterfinal"])
    ].filter(([x]) => x);
    const out = {};
    for (const [id, finish2] of placed) {
      const cur = current3[id] || {};
      const prev = cur[FIELDS2.best];
      out[id] = {
        [FIELDS2.titles]: (cur[FIELDS2.titles] || 0) + (finish2 === "champion" ? 1 : 0),
        [FIELDS2.best]: FINISH_ORDER.indexOf(finish2) > FINISH_ORDER.indexOf(prev) ? finish2 : prev,
        [FIELDS2.last]: date
      };
    }
    return out;
  }
  var HALF = 10;
  var clampRating = (r) => Math.min(100, Math.max(HALF, r));
  var quarterStars = (r) => Math.round(r / 5) * 5;
  function finishLabel(short) {
    return ["Champion", "Finalist", "Semifinalist", "Quarterfinalist"][short] || `Round of ${2 ** short}`;
  }
  function treeOrder(st) {
    const beaten = /* @__PURE__ */ new Map();
    const conqueror = /* @__PURE__ */ new Map();
    const outIn = /* @__PURE__ */ new Map();
    st.rounds.forEach((round, ri) => {
      for (const m of round) {
        if (m.bye || !m.winner || !m.a || !m.b) continue;
        const w = m.winner;
        const l = w === m.a ? m.b : m.a;
        const set2 = beaten.get(w) || /* @__PURE__ */ new Set();
        set2.add(l);
        for (const x of beaten.get(l) || []) set2.add(x);
        beaten.set(w, set2);
        conqueror.set(l, w);
        outIn.set(l, ri);
      }
    });
    const above = (id) => {
      const out = [];
      for (let c = conqueror.get(id); c; c = conqueror.get(c)) out.push(c);
      return out;
    };
    return {
      beaten: (id) => beaten.get(id) || /* @__PURE__ */ new Set(),
      above,
      outIn,
      conqueror: (id) => conqueror.get(id)
    };
  }
  var SCALE_MIN = 10;
  var EVEN_SCALE = [20, 100];
  function universeOf(M, kind, gender) {
    return kind === "performer" ? performerPool(M, { gender, pool: "library" }) : bracketScenes(M).map((s) => s.id);
  }
  function safeStrength(M, kind) {
    const strength = strengthOf(M, kind);
    return (id) => {
      const there = kind === "performer" ? !!M.db.performers.get(id)?.local : !!M.db.scenes.get(id)?.owned;
      return there ? strength(id) : -Infinity;
    };
  }
  function entrantSpread(M, kind, gender, ids) {
    const strength = safeStrength(M, kind);
    const all = universeOf(M, kind, gender).map(strength).sort((a, b) => b - a);
    const n = Math.max(all.length, 1);
    const EPS = 1e-9;
    const countWhile = (ok) => {
      let lo = 0;
      let hi = all.length;
      while (lo < hi) {
        const mid = lo + hi >> 1;
        if (ok(all[mid])) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const ties = /* @__PURE__ */ new Map();
    for (const id of ids) {
      const v = strength(id);
      const start = countWhile((x) => x > v + EPS);
      const end = Math.max(
        countWhile((x) => x >= v - EPS),
        start + 1
      );
      const key = start + ":" + end;
      ties.set(key, [...ties.get(key) || [], id]);
    }
    const out = [];
    for (const [key, list] of ties) {
      const [start, end] = key.split(":").map(Number);
      list.forEach((_, j) => {
        const place = start + (j + 0.5) * (end - start) / list.length;
        out.push(
          Math.round(Math.min(1, Math.max(0, 1 - place / n)) * 1e3) / 1e3
        );
      });
    }
    return out.sort((a, b) => b - a);
  }
  function quantileOf(values, q) {
    if (!values.length) return null;
    const p = Math.min(1, Math.max(0, q)) * (values.length - 1);
    const i = Math.floor(p);
    const next = values[Math.min(i + 1, values.length - 1)];
    return values[i] + (next - values[i]) * (p - i);
  }
  function ratingScale(M, kind, gender) {
    const ids = universeOf(M, kind, gender);
    const own = ids.filter((id) => entrantRole(M, kind, id) === "anchor").map((id) => stashRatingOf(M, kind, id)).sort((a, b) => a - b);
    if (own.length >= SCALE_MIN) return { values: own, source: "own" };
    if (kind === "clip" && ids.length >= SCALE_MIN) {
      const score = ids.map((id) => M.estimate(id) * 20).sort((a, b) => a - b);
      if (quantileOf(score, 0.9) - quantileOf(score, 0.1) >= 20)
        return { values: score, source: "score" };
    }
    return { values: EVEN_SCALE, source: "even" };
  }
  var SCALE_NAMES = {
    own: "your ratings",
    score: "Your score",
    even: "a one to five star scale"
  };
  var placeText = (q, source) => {
    const where = q >= 0.5 ? `the top ${Math.max(1, Math.round((1 - q) * 100))}%` : `the bottom ${Math.max(1, Math.round(q * 100))}%`;
    return `in ${where} of ${SCALE_NAMES[source]}`;
  };
  function finishOrder(M, b, st, tree) {
    const champ = st.result.champion;
    const rounds = st.rounds.length;
    const reach = (id) => id == null ? -1 : id === champ ? rounds : tree.outIn.get(id) ?? -1;
    const strength = safeStrength(M, b.kind);
    return b.seeds.slice().sort(
      (x, y) => reach(y) - reach(x) || reach(tree.conqueror(y)) - reach(tree.conqueror(x)) || strength(y) - strength(x) || (x < y ? -1 : 1)
    );
  }
  function ratingProposals(M, b) {
    const kind = b.kind;
    const st = bracketState(b);
    if (!st.done) return { rows: [], askChampion: false };
    const tree = treeOrder(st);
    const { beaten, above, outIn } = tree;
    const rounds = st.rounds.length;
    const champ = st.result.champion;
    const present = (id) => kind === "performer" ? !!M.db.performers.get(id)?.local : !!M.db.scenes.get(id)?.owned;
    const anchors = b.anchors || Object.fromEntries(
      b.seeds.filter((id) => present(id) && entrantRole(M, kind, id) === "anchor").map((id) => [id, stashRatingOf(M, kind, id)])
    );
    const isAnchor = (id) => has(anchors, id);
    const cs = challengeState(b);
    const ref = { ...b.challenge?.ratings || {}, ...anchors };
    const pickRef = (ids, better) => {
      let out = null;
      for (const id of ids)
        if (has(ref, id) && (out == null || better(ref[id], ref[out]))) out = id;
      return out;
    };
    const lowOf = (id) => pickRef(
      id === champ && cs ? [...beaten(id), ...cs.beaten] : beaten(id),
      (x, y) => x > y
    );
    const highOf = (id) => pickRef(
      id === champ && cs?.lostTo ? [...above(id), cs.lostTo] : above(id),
      (x, y) => x < y
    );
    const measured = (lo, hi) => hi != null ? clampRating(quarterStars((ref[lo] + ref[hi]) / 2)) : clampRating(ref[lo] + HALF);
    const name = (id) => (kind === "performer" ? M.db.performers.get(id)?.name : M.db.scenes.get(id)?.title) || "Untitled";
    const fromScenes = /* @__PURE__ */ new Set([
      ...b.sceneAnchors || [],
      ...b.challenge?.sceneRungs || []
    ]);
    const label = (id) => `${name(id)} (${fmtStars(ref[id] / 20)}★${fromScenes.has(id) ? " from your scene ratings" : ""})`;
    const champLo = isAnchor(champ) ? null : lowOf(champ);
    const order = finishOrder(M, b, st, tree);
    const spread = b.spread?.length ? b.spread : entrantSpread(M, kind, b.gender, b.seeds);
    const scale = ratingScale(M, kind, b.gender);
    const place = new Map(order.map((id, k) => [id, k]));
    const shareOf = (id) => spread[Math.min(place.get(id), spread.length - 1)];
    const fromFinish = (id) => quantileOf(scale.values, shareOf(id));
    const champHi = highOf(champ);
    let top = fromFinish(champ);
    if (isAnchor(champ)) top = anchors[champ];
    else if (champLo != null) top = measured(champLo, champHi);
    else if (b.championRating != null) top = b.championRating;
    else if (champHi != null) top = Math.min(top, ref[champHi] - HALF);
    const shift = top - fromFinish(champ);
    const rows = [];
    for (const id of b.seeds) {
      if (isAnchor(id) || !present(id)) continue;
      const role = entrantRole(M, kind, id);
      if (role === "anchor") continue;
      const short = id === champ ? 0 : rounds - outIn.get(id);
      let to;
      let why;
      let provisional = false;
      const lo = lowOf(id);
      const hi = highOf(id);
      if (lo != null) {
        to = measured(lo, hi);
        why = hi != null ? `Above ${label(lo)}, below ${label(hi)}` : `Above ${label(lo)}`;
      } else if (id === champ && b.championRating != null) {
        to = b.championRating;
        why = "Your rating for the champion";
      } else {
        to = clampRating(quarterStars(fromFinish(id) + shift));
        why = id === champ && shift < 0 ? `${finishLabel(0)}, below ${label(champHi)}` : `${finishLabel(short)}, ${placeText(shareOf(id), scale.source)}${shift ? ", moved with the champion" : ""}`;
        if (hi != null && ref[hi] - HALF < to) {
          to = clampRating(ref[hi] - HALF);
          why = `${finishLabel(short)}, below ${label(hi)}`;
        }
        provisional = true;
      }
      const from = stashRatingOf(M, kind, id);
      const row = { id, from, to, why, provisional, short, place: place.get(id) };
      if (isProvisional(recordOf(M, kind, id)?.local, from))
        row.fromProvisional = true;
      if (role === "ranked") {
        if (short > 3) continue;
        row.skip = M.ratingSource(kind, id) === "mirror" ? "mirrored" : "ranked";
        row.why = finishLabel(short);
      } else if (to == null) continue;
      else if (M.ratingSource(kind, id) === "primed") row.primed = true;
      else if (from === to) continue;
      rows.push(row);
    }
    rows.sort((x, y) => x.place - y.place);
    return { rows, askChampion: false };
  }
  function proposedChange(row) {
    const { id, from, to, provisional } = row;
    return { id, from, to, provisional, fromProvisional: !!row.fromProvisional };
  }
  function writableChanges(changes2, current3) {
    const write = [];
    const ranked = [];
    const changed2 = [];
    for (const c of changes2) {
      const rec = current3.get(c.id);
      if (!rec) continue;
      if (pluginRating(rec)) ranked.push(c.id);
      else if ((rec.rating100 ?? null) !== c.from || c.fromProvisional && !isProvisional(rec))
        changed2.push(c.id);
      else
        write.push({
          ...c,
          fromProvisional: rec.custom_fields?.[PROVISIONAL_FIELD] ?? null
        });
    }
    return { write, ranked, changed: changed2 };
  }
  function undoableChanges(changes2, current3) {
    const write = [];
    const ranked = [];
    const changed2 = [];
    for (const c of changes2) {
      const rec = current3.get(c.id);
      if (!rec) continue;
      if (pluginRating(rec)) ranked.push(c.id);
      else if ((rec.rating100 ?? null) !== c.to || c.provisional && !isProvisional(rec))
        changed2.push(c.id);
      else write.push(c);
    }
    return { write, ranked, changed: changed2 };
  }
  function provisionalFieldsInput(to, provisional, had) {
    if (provisional && to != null) return { partial: { [PROVISIONAL_FIELD]: to } };
    if (had != null && had !== "") return { remove: [PROVISIONAL_FIELD] };
    return null;
  }
  function restoreProvisionalInput(change) {
    const had = change.fromProvisional;
    if (had != null && had !== "")
      return { partial: { [PROVISIONAL_FIELD]: had } };
    return change.provisional ? { remove: [PROVISIONAL_FIELD] } : null;
  }

  // src/js/runtime/engine.js
  function allDecisions(state) {
    const out = [];
    for (const b of state.brackets.history)
      if (b.decisions) out.push(...modelDecisions(b));
    if (state.brackets.active) out.push(...modelDecisions(state.brackets.active));
    return out;
  }
  var built = { lists: null, stashdbData: null, db: null, engine: null };
  var listsOf = (lib) => lib && [lib.scenes, lib.performers, lib.tags, lib.studios];
  var sameLists = (a, b) => !!a && !!b && a.every((x, i) => x === b[i]);
  var pending = null;
  var cvSummary = (cv) => {
    if (!cv) return null;
    const { rows, ...rest } = cv;
    return rest;
  };
  var cvRun = null;
  function finishCvLater(engine) {
    if (cvRun?.engine === engine) return;
    const steps = engine.finishCv();
    cvRun = { engine };
    const run2 = cvRun;
    const idle = window.requestIdleCallback ? (fn) => window.requestIdleCallback(fn, { timeout: 2e3 }) : (fn) => setTimeout(fn, 50);
    const step = () => {
      if (cvRun !== run2) return;
      const { done, value } = steps.next();
      if (!done) return idle(step);
      cvRun = null;
      if (!value || built.engine !== engine) return;
      local.set(KEYS.cv, cvSummary(value));
      if (!pending) pending = setTimeout(recompute, 0);
    };
    idle(step);
  }
  function recompute() {
    pending = null;
    const s = store.get();
    if (!s.library) return;
    const lists2 = listsOf(s.library);
    const sameLibrary = sameLists(lists2, built.lists);
    if (!sameLibrary || s.stashdbData !== built.stashdbData) {
      const db2 = buildDb({
        asOf: Date.parse(s.library.syncedAt),
        scenes: s.library.scenes,
        performers: s.library.performers,
        tags: s.library.tags,
        studios: s.library.studios,
        stashdb: s.stashdbData || void 0
      });
      const reuse = sameLibrary && built.engine;
      built = {
        lists: lists2,
        stashdbData: s.stashdbData,
        db: db2,
        engine: createEngine(db2, {
          ...reuse ? { fits: built.engine.cache } : {},
          deferCv: true,
          provisionalCv: local.get(KEYS.cv)
        })
      };
    }
    const t0 = performance.now();
    const M = built.engine.compute({
      overrides: {},
      performerOverrides: {},
      decisions: allDecisions(s),
      notInterested: s.notInterested,
      dontLearn: s.dontLearn.map((d) => d.sceneId),
      learnFromMatches: !!s.settings.learnFromMatches
    });
    store.set({
      db: built.db,
      M,
      modelMs: Math.round(performance.now() - t0),
      // the StashDB data this model was built with (stashdb/layer.js waits
      // for it before showing a page's answers)
      modelStashdb: built.stashdbData
    });
    if (M.fits.cvPending) finishCvLater(built.engine);
  }
  function computeWithDecisions(decisions) {
    const s = store.get();
    if (!built.engine || !sameLists(listsOf(s.library), built.lists)) return null;
    return built.engine.compute({
      overrides: {},
      performerOverrides: {},
      decisions,
      notInterested: s.notInterested,
      dontLearn: s.dontLearn.map((d) => d.sceneId),
      learnFromMatches: !!s.settings.learnFromMatches
    });
  }
  var INPUTS = [
    "stashdbData",
    "brackets",
    "notInterested",
    "dontLearn"
  ];
  var SETTINGS = ["learnFromMatches"];
  function keepModelCurrent() {
    store.subscribe((next, prev) => {
      if ((next.library === prev.library || sameLists(listsOf(next.library), listsOf(prev.library))) && !INPUTS.some((k) => next[k] !== prev[k]) && !SETTINGS.some((k) => next.settings?.[k] !== prev.settings?.[k]))
        return;
      if (!pending) pending = setTimeout(recompute, 0);
    });
  }

  // src/js/model/watch.js
  var playable = (s) => !!s.hasVideo;
  function watchOrder(ctx, signals) {
    if (tooSmall(ctx.db)) return newestOrder(ctx);
    return rankedScenes(ctx, signals, playable).map((x) => ({
      scene: x.scene,
      reason: () => reasonFor(ctx, x)
    }));
  }
  function newestOrder(ctx) {
    const first = newInLibrary(ctx, { keep: playable, size: Infinity });
    const seen = new Set(first.map((it) => it.scene.id));
    const rest = ctx.db.owned.filter((s) => playable(s) && allowed(ctx, s) && !seen.has(s.id)).sort((a, b) => b.local.created_at.localeCompare(a.local.created_at));
    return [
      ...first.map((it) => ({ scene: it.scene, reason: () => it.reason })),
      ...rest.map((s) => ({
        scene: s,
        reason: () => `Added ${timeAgo(s.local.created_at, ctx.now)}`
      }))
    ];
  }
  var HOUR = 36e5;
  var LADDER_HOURS = [48, 7 * 24, 30 * 24];
  var stepLength = (step) => LADDER_HOURS[Math.min(step, LADDER_HOURS.length) - 1] * HOUR;
  var MAX_SNOOZES = 300;
  var IGNORED_DAYS = 3;
  var LOOK_MS = 2 * 60 * 1e3;
  var watchedEnough = (playedSeconds2, duration) => duration > 0 && playedSeconds2 >= WATCHED_SHARE * duration;
  var entryOf = (snoozes, id) => snoozes.find((e) => e.id === id) || null;
  var without = (snoozes, id) => snoozes.filter((e) => e.id !== id);
  var stepUp = (cur, id, now) => {
    const step = (cur?.step || 0) + 1;
    return { id, step, until: now + stepLength(step), at: now };
  };
  function settle(snoozes, scenes) {
    const out = snoozes.filter((e) => {
      const s = scenes.get(e.id);
      if (!s?.local) return true;
      return !s.local.play_history.some((t) => Date.parse(t) > e.at + LOOK_MS);
    });
    return out.length === snoozes.length ? snoozes : out;
  }
  function capped(snoozes) {
    if (snoozes.length <= MAX_SNOOZES) return snoozes;
    const ended = (e) => Math.max(e.until || 0, e.at || 0);
    const keep = new Set(
      [...snoozes].sort((a, b) => ended(b) - ended(a)).slice(0, MAX_SNOOZES).map((e) => e.id)
    );
    return snoozes.filter((e) => keep.has(e.id));
  }
  function skipScene(snoozes, id, now, { watched = false } = {}) {
    const prev = entryOf(snoozes, id);
    const next = watched ? { ...stepUp(null, id, now), ignored: 0, ignoredDay: null } : {
      ...stepUp(prev, id, now),
      ignored: prev?.ignored || 0,
      ignoredDay: prev?.ignoredDay || null
    };
    return { snoozes: capped([...without(snoozes, id), next]), prev };
  }
  function unskipScene(snoozes, id, prev, now) {
    const rest = without(snoozes, id);
    return prev ? [...rest, { ...prev, at: now }] : rest;
  }
  function ignoreScene(snoozes, id, now, day2) {
    const cur = entryOf(snoozes, id);
    if (cur?.ignoredDay === day2) return snoozes;
    const ignored = (cur?.ignored || 0) + 1;
    const next = ignored >= IGNORED_DAYS ? { ...stepUp(cur, id, now), ignored: 0, ignoredDay: day2 } : {
      id,
      step: cur?.step || 0,
      until: cur?.until || 0,
      at: cur?.at ?? now,
      ignored,
      ignoredDay: day2
    };
    return capped([...without(snoozes, id), next]);
  }
  function nextPick(order, snoozes, skipped, now) {
    if (!order.length) return null;
    const ends = new Map(
      snoozes.filter((e) => e.until > now).map((e) => [e.id, e.until])
    );
    const free = order.filter((it) => !ends.has(it.scene.id));
    const avoid = new Set(skipped.flatMap((s) => s.performers.map((p) => p.id)));
    return free.find((it) => !it.scene.performers.some((p) => avoid.has(p.id))) || free[0] || [...order].sort((a, b) => ends.get(a.scene.id) - ends.get(b.scene.id))[0];
  }

  // src/js/runtime/watchThis.js
  var snap = null;
  var playedMs = 0;
  var playingSince = null;
  function pickPlaying(on) {
    if (on) playingSince ?? (playingSince = Date.now());
    else if (playingSince != null) {
      playedMs += Date.now() - playingSince;
      playingSince = null;
    }
  }
  var playedSeconds = () => (playedMs + (playingSince != null ? Date.now() - playingSince : 0)) / 1e3;
  function newPick() {
    playedMs = 0;
    playingSince = null;
  }
  var keyOf = (s) => [s.visit, JSON.stringify(s.settings)].join("|");
  function watchSnapshot(s) {
    if (!s.M || !s.configLoaded) return null;
    const key = keyOf(s);
    if (snap?.key === key) return snap;
    const skip2 = new Set(s.dontLearn.map((d) => d.sceneId));
    const order = watchOrder(context(s.M, s), visitSignals(s.signals, skip2));
    const { scenes } = s.M.db;
    const snoozes = settle(s.snoozes, scenes);
    newPick();
    snap = {
      key,
      order,
      byId: new Map(order.map((it) => [it.scene.id, it])),
      first: nextPick(order, snoozes, [], Date.now())?.scene.id ?? null
    };
    if (snoozes !== s.snoozes)
      setTimeout(
        () => store.set((x) => {
          const settled2 = settle(x.snoozes, scenes);
          return settled2 === x.snoozes ? null : { snoozes: settled2 };
        })
      );
    return snap;
  }
  function visitState(s, v = snap?.key === keyOf(s) ? snap : null) {
    if (!v) return null;
    if (s.watchVisit?.key === v.key) return s.watchVisit;
    return { key: v.key, current: v.first, skips: [], started: false };
  }
  function skip() {
    const s = store.get();
    const v = watchSnapshot(s);
    const cur = visitState(s, v);
    if (!cur?.current) return;
    const now = Date.now();
    const watched = watchedEnough(
      playedSeconds(),
      v.byId.get(cur.current)?.scene.duration
    );
    newPick();
    const { snoozes, prev } = skipScene(s.snoozes, cur.current, now, {
      watched
    });
    const skips = [...cur.skips, { id: cur.current, prev }];
    const skipped = skips.map((k) => v.byId.get(k.id)?.scene).filter(Boolean);
    const next = nextPick(v.order, snoozes, skipped, now);
    store.set({
      snoozes,
      watchVisit: {
        ...cur,
        current: next?.scene.id ?? null,
        skips,
        started: false
      }
    });
  }
  function back() {
    const s = store.get();
    const cur = visitState(s);
    const last = cur?.skips[cur.skips.length - 1];
    if (!last) return;
    newPick();
    store.set({
      snoozes: unskipScene(s.snoozes, last.id, last.prev, Date.now()),
      watchVisit: {
        ...cur,
        current: last.id,
        skips: cur.skips.slice(0, -1),
        started: false
      }
    });
  }
  function pickStarted() {
    const s = store.get();
    const cur = visitState(s);
    if (cur && !cur.started) store.set({ watchVisit: { ...cur, started: true } });
  }
  function endVisit() {
    const s = store.get();
    const cur = visitState(s);
    if (!s.settings.watchThis || !cur || cur.ended) return;
    store.set({ watchVisit: { ...cur, ended: true } });
    if (!cur.current || cur.started) return;
    const now = Date.now();
    store.set((x) => ({
      snoozes: ignoreScene(x.snoozes, cur.current, now, localDay(now))
    }));
  }
  onLocation((loc, prev) => {
    if (onFrontPage(prev) && !onFrontPage(loc)) endVisit();
  });
  window.addEventListener("pagehide", () => {
    if (onFrontPage()) endVisit();
  });

  // src/js/runtime/watching.js
  var PLAYER = ".scene-player-container, .cherrypick-watch-player";
  var WATCH_THIS = ".cherrypick-watch-player";
  function watchPlayback() {
    document.addEventListener(
      "play",
      (e) => {
        if (!(e.target instanceof HTMLMediaElement)) return;
        if (!e.target.closest(PLAYER)) return;
        if (e.target.closest(WATCH_THIS)) pickStarted();
        if (!store.get().watching) store.set({ watching: true });
      },
      true
    );
    const playing = (on) => (e) => {
      if (e.target instanceof HTMLMediaElement && e.target.closest(WATCH_THIS))
        pickPlaying(on);
    };
    document.addEventListener("playing", playing(true), true);
    for (const type of ["pause", "waiting", "ended", "emptied"])
      document.addEventListener(type, playing(false), true);
    store.subscribe((next, prev) => {
      if (next.watching !== prev.watching)
        document.body.classList.toggle("cherrypick-watching", next.watching);
    });
  }

  // src/js/model/curator.js
  var CURATOR = /^stash[\s_-]*curator\b/i;
  var curatorEnabled = (plugins) => (plugins || []).some(
    (p) => p.enabled && (CURATOR.test(p.id) || CURATOR.test(p.name || ""))
  );
  var offersToHide = ({ curator, badges, answer }) => curator === true && !!badges && answer == null;
  var answerSettings = (answer) => answer === "hide" ? { badges: false } : {};

  // src/js/runtime/actions.js
  function markNotInterested(item, rowId) {
    const { M, db: db2 } = store.get();
    const key = item.key || (M ? blameKey(M.prediction(item.scene.id)) : null);
    store.set((s) => ({
      notInterested: [
        ...s.notInterested.filter((n) => n.sceneId !== item.scene.id),
        {
          sceneId: item.scene.id,
          key,
          label: db2 ? keyLabel(db2, key) : null,
          title: item.scene.title,
          owned: !!item.scene.owned,
          at: (/* @__PURE__ */ new Date()).toISOString()
        }
      ],
      recentHidden: [
        ...s.recentHidden,
        { sceneId: item.scene.id, rowId, title: item.scene.title }
      ]
    }));
  }
  function undoNotInterested(sceneId) {
    store.set((s) => ({
      notInterested: s.notInterested.filter((n) => n.sceneId !== sceneId),
      recentHidden: s.recentHidden.filter((x) => x.sceneId !== sceneId)
    }));
  }
  var isDontLearn = (state, sceneId) => state.dontLearn.some((d) => d.sceneId === sceneId);
  function toggleDontLearn(scene) {
    store.set(
      (s) => isDontLearn(s, scene.id) ? { dontLearn: s.dontLearn.filter((d) => d.sceneId !== scene.id) } : {
        dontLearn: [
          ...s.dontLearn,
          {
            sceneId: scene.id,
            title: scene.title,
            at: (/* @__PURE__ */ new Date()).toISOString()
          }
        ]
      }
    );
  }
  function recordOpen(sceneId) {
    const s = store.get();
    const skip2 = new Set(s.dontLearn.map((d) => d.sceneId));
    store.set({ signals: openSignals(s.signals, sceneId, skip2) });
  }
  function answerCuratorOffer(answer, { stashSaves = false } = {}) {
    store.set({ curatorOffer: answer });
    const settings = answerSettings(answer);
    if (!Object.keys(settings).length) return;
    if (stashSaves)
      store.set((s) => ({ settings: { ...s.settings, ...settings } }));
    else changeSettings(settings);
  }

  // src/js/ui/hooks.js
  var useAppState = (select) => useStoreValue(store, select);
  var useSettings = () => useStoreValue(store, (s) => s.settings);
  var useModel = () => useStoreValue(store, (s) => s.M);

  // src/js/ui/CardMenu.jsx
  var { Dropdown } = Bootstrap;
  var { faEllipsisH, faEyeSlash, faShieldAlt, faCheck } = FontAwesomeSolid;
  function CardMenu({ item, rowId }) {
    const { Icon: Icon3 } = components;
    const dontLearn = useAppState((s) => isDontLearn(s, item.scene.id));
    return /* @__PURE__ */ React.createElement(Dropdown, { className: "cherrypick-card-menu cherrypick-ui", drop: "up" }, /* @__PURE__ */ React.createElement(
      Dropdown.Toggle,
      {
        variant: "secondary",
        className: "minimal",
        title: "More",
        bsPrefix: "btn"
      },
      /* @__PURE__ */ React.createElement(Icon3, { icon: faEllipsisH })
    ), /* @__PURE__ */ React.createElement(Dropdown.Menu, { align: "right" }, /* @__PURE__ */ React.createElement(
      Dropdown.Item,
      {
        className: "cherrypick-ni",
        onClick: () => markNotInterested(item, rowId)
      },
      /* @__PURE__ */ React.createElement(Icon3, { icon: faEyeSlash }),
      " Not interested"
    ), item.scene.owned ? /* @__PURE__ */ React.createElement(
      Dropdown.Item,
      {
        className: "cherrypick-dl",
        onClick: () => toggleDontLearn(item.scene)
      },
      /* @__PURE__ */ React.createElement(Icon3, { icon: dontLearn ? faCheck : faShieldAlt }),
      " ",
      dontLearn ? "Not learning from this (undo)" : "Don't learn from this"
    ) : null));
  }

  // src/js/ui/Safe.jsx
  var Safe = class extends React2.Component {
    constructor(props) {
      super(props);
      this.state = { failed: false };
    }
    static getDerivedStateFromError() {
      return { failed: true };
    }
    componentDidCatch(error, info) {
      console.error(
        `${PLUGIN_ID}: ${this.props.name || "a piece"} failed and was removed`,
        error,
        info?.componentStack
      );
    }
    render() {
      return this.state.failed ? null : this.props.children;
    }
  };

  // src/js/ui/rowCards.jsx
  var RowItem = React2.createContext(null);
  function Reason() {
    const ctx = React2.useContext(RowItem);
    if (!ctx?.item.reason) return null;
    return /* @__PURE__ */ React2.createElement("div", { className: "scene-card__description cherrypick-reason cherrypick-ui" }, ctx.item.reason);
  }
  function Menu() {
    const ctx = React2.useContext(RowItem);
    if (!ctx || !ctx.item.scene) return null;
    return /* @__PURE__ */ React2.createElement(CardMenu, { item: ctx.item, rowId: ctx.rowId });
  }
  function MenuRow() {
    const ctx = React2.useContext(RowItem);
    if (!ctx || !ctx.item.scene) return null;
    return /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement("hr", null), /* @__PURE__ */ React2.createElement("div", { className: "card-popovers btn-group" }, /* @__PURE__ */ React2.createElement(Menu, null)));
  }
  function withMenu(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 4) return null;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const found = withMenu(node[i], depth + 1);
        if (found) return node.map((n, j) => j === i ? found : n);
      }
      return null;
    }
    const props = node.props || {};
    if (String(props.className || "").includes("card-popovers"))
      return React2.cloneElement(
        node,
        {},
        ...[].concat(props.children ?? []),
        /* @__PURE__ */ React2.createElement(Menu, { key: "cherrypick-menu" })
      );
    if (props.children == null) return null;
    const inner = withMenu(props.children, depth + 1);
    if (!inner) return null;
    return Array.isArray(inner) ? React2.cloneElement(node, {}, ...inner) : React2.cloneElement(node, {}, inner);
  }
  function registerRowCards() {
    patchAfter("SceneCard.Details", (props, result) => /* @__PURE__ */ React2.createElement(React2.Fragment, null, result, /* @__PURE__ */ React2.createElement(Safe, { name: "row reason" }, /* @__PURE__ */ React2.createElement(Reason, null))));
    patchAfter(
      "SceneCard.Popovers",
      (props, result) => withMenu(result) || /* @__PURE__ */ React2.createElement(React2.Fragment, null, result, /* @__PURE__ */ React2.createElement(Safe, { name: "card menu" }, /* @__PURE__ */ React2.createElement(MenuRow, null)))
    );
  }
  function RowSceneCard({ scene, item, rowId, index: index2, onOpen }) {
    const { SceneCard } = components;
    if (!SceneCard) return null;
    return /* @__PURE__ */ React2.createElement(RowItem.Provider, { value: { item, rowId } }, /* @__PURE__ */ React2.createElement(
      "div",
      {
        className: "cherrypick-card",
        onClickCapture: (e) => {
          if (onOpen && e.target.closest("a[href]")) onOpen(item.scene.id);
        }
      },
      /* @__PURE__ */ React2.createElement(SceneCard, { scene, index: index2, zoomIndex: 1 })
    ));
  }

  // src/js/features/scoreBadge.jsx
  function scoreFor(M, scene, relative) {
    if (!M?.gate || !unratedByYou(M, scene)) return null;
    const p = M.prediction(scene.id);
    if (!p) return null;
    return { value: p.value, label: badgeLabel(M, p.value, relative) };
  }
  function useNoInlineStyle() {
    const [el, ref] = React2.useState(null);
    React2.useEffect(() => {
      if (!el) return;
      const drop = () => el.hasAttribute("style") && el.removeAttribute("style");
      drop();
      const watch = new MutationObserver(drop);
      watch.observe(el, { attributes: true, attributeFilter: ["style"] });
      return () => watch.disconnect();
    }, [el]);
    return ref;
  }
  function ScoreCorner({ scene }) {
    const M = useModel();
    const settings = useSettings();
    const ref = useNoInlineStyle();
    if (!settings.badges) return null;
    const s = scoreFor(M, scene, settings.relativeBadges);
    if (!s) return null;
    const r = M.reason(scene.id);
    const title = `Your score ${fmtStars(s.value)}★${r ? ": " + r.text : ""}. ${NAME_S} guess; never written to your rating.`;
    return /* @__PURE__ */ React2.createElement(
      "div",
      {
        ref,
        className: "rating-banner cherrypick-score-banner cherrypick-ui",
        title
      },
      s.label.corner,
      s.label.relative ? null : /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-star" }, "★")
    );
  }
  function registerScoreBadge() {
    patchAfter("SceneCard.Image", (props, result) => /* @__PURE__ */ React2.createElement(React2.Fragment, null, result, /* @__PURE__ */ React2.createElement(Safe, { name: "score badge" }, /* @__PURE__ */ React2.createElement(ScoreCorner, { scene: props.scene }))));
  }

  // src/js/ui/BuildingLine.jsx
  var count = (n) => n.toLocaleString("en-US");
  function BuildingLine() {
    const progress = useAppState((s) => s.loadProgress);
    const library = useAppState((s) => s.library);
    if (!progress) return null;
    return /* @__PURE__ */ React.createElement("span", { className: "text-muted small cherrypick-building" }, library ? `Learning your taste from ${count(library.scenes.length)} scenes…` : `Reading your library: ${count(progress.n)} of ${count(progress.of)} ${progress.kind}…`);
  }

  // src/js/ui/records.js
  var { useEffect: useEffect2, useState: useState2 } = React2;
  var fetchers = {
    scene: async (ids) => (await utils.StashService.queryFindScenesByID(ids.map(Number))).data.findScenes.scenes,
    performer: async (ids) => (await utils.StashService.queryFindPerformersByID(ids.map(Number))).data.findPerformers.performers
  };
  function useStashRecords(kind, ids) {
    const key = ids.join(",");
    const [records, setRecords] = useState2(null);
    useEffect2(() => {
      let live = true;
      if (!ids.length) {
        setRecords([]);
        return;
      }
      fetchers[kind](ids).then((rows) => {
        if (!live) return;
        const byId = new Map(rows.map((r) => [r.id, r]));
        setRecords(ids.map((id) => byId.get(id)).filter(Boolean));
      }).catch((e) => {
        console.error("CherryPick:", e);
        if (live) setRecords([]);
      });
      return () => {
        live = false;
      };
    }, [kind, key]);
    return records;
  }

  // src/js/ui/Row.jsx
  var Slider = window.PluginApi.libraries.ReactSlick.default;
  var { Link } = ReactRouterDOM;
  function slidesToScroll(cards, show, isTouch2) {
    if (isTouch2) return 1;
    return cards > show ? show : cards;
  }
  function sliderSettings(cards, isTouch2) {
    const at = (show) => ({
      infinite: !isTouch2 && cards > show,
      slidesToShow: cards > show ? show : cards,
      slidesToScroll: slidesToScroll(cards, show, isTouch2)
    });
    return {
      dots: !isTouch2,
      arrows: !isTouch2,
      speed: 300,
      variableWidth: true,
      swipeToSlide: true,
      ...at(5),
      responsive: [
        { breakpoint: 1909, settings: at(4) },
        { breakpoint: 1542, settings: at(3) },
        { breakpoint: 1170, settings: at(2) },
        { breakpoint: 801, settings: at(1) }
      ]
    };
  }
  var isTouch = () => window.matchMedia("(pointer: coarse)").matches;
  var { loadableComponents } = window.PluginApi;
  var NEEDED = [
    loadableComponents.FrontPage,
    loadableComponents.SceneCard,
    loadableComponents.PerformerCard
  ];
  var useRowComponents = () => !hooks.useLoadComponents(NEEDED);
  function Row({ id, title, className = "", link, extra, children }) {
    const ready = useRowComponents();
    const { RecommendationRow } = components;
    if (!ready || !RecommendationRow) return null;
    return /* @__PURE__ */ React.createElement(
      RecommendationRow,
      {
        className: `cherrypick-row cherrypick-row-${id} ${className}`,
        header: title,
        link: /* @__PURE__ */ React.createElement("div", { className: "recommendation-row-extra" }, extra, link ? /* @__PURE__ */ React.createElement(Link, { to: link.to }, link.text) : null)
      },
      children
    );
  }
  function CardRow({
    kind,
    items,
    renderCard,
    skeleton = 12,
    empty,
    ...row
  }) {
    const fromDb = kind === "stashdb-scene";
    const ids = (items || []).map(
      (it) => (kind === "performer" ? it.performer : it.scene).id
    );
    const stashRecords = useStashRecords(
      fromDb ? "scene" : kind,
      items && !fromDb ? ids : []
    );
    const records = fromDb ? items && items.map((it) => it.scene) : stashRecords;
    const loading2 = !items || !records;
    const skeletonClass = kind === "performer" ? "performer-skeleton" : "scene-skeleton";
    let body;
    if (loading2)
      body = /* @__PURE__ */ React.createElement(Slider, { ...sliderSettings(skeleton, isTouch()) }, [...Array(skeleton)].map((_, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: `${skeletonClass} skeleton-card` })));
    else if (!records.length)
      body = empty ? /* @__PURE__ */ React.createElement("div", { className: "cherrypick-row-empty text-muted" }, empty) : null;
    else {
      const byId = new Map(records.map((r) => [r.id, r]));
      body = /* @__PURE__ */ React.createElement(Slider, { ...sliderSettings(records.length, isTouch()) }, items.map((it, i) => {
        const rec = byId.get(ids[i]);
        return rec ? renderCard(rec, it, i) : null;
      }).filter(Boolean));
    }
    if (!loading2 && !records.length && !empty) return null;
    return /* @__PURE__ */ React.createElement(Row, { ...row }, body);
  }
  function HiddenCard({ title, onUndo }) {
    return /* @__PURE__ */ React.createElement("div", { className: "card grid-card scene-card zoom-1 cherrypick-hidden-card cherrypick-ui" }, /* @__PURE__ */ React.createElement("div", { className: "card-section text-muted" }, /* @__PURE__ */ React.createElement("p", null, "Hidden. You'll see less like “", title, "”."), /* @__PURE__ */ React.createElement("button", { className: "btn btn-sm btn-secondary", onClick: onUndo }, "Undo")));
  }

  // src/js/features/hallOfFame.jsx
  function championIds(history) {
    const done = history.filter((b) => b.kind === "performer" && b.result?.champion).sort((a, b) => (b.finishedAt || "").localeCompare(a.finishedAt || ""));
    const genders = [...new Set(done.map((b) => b.gender || ""))];
    const seen = /* @__PURE__ */ new Set();
    return genders.flatMap(
      (g) => done.filter((b) => (b.gender || "") === g).map((b) => b.result.champion).filter((id) => !seen.has(id) && seen.add(id))
    );
  }
  function HallOfFameRow({ extra }) {
    const show = useAppState((s) => s.settings.showHallOfFame);
    const history = useAppState((s) => s.brackets.history);
    const active = useAppState((s) => s.brackets.active);
    if (!show) return null;
    const ids = championIds(history);
    if (!ids.length && !active) return null;
    const { PerformerCard } = components;
    return /* @__PURE__ */ React.createElement(
      CardRow,
      {
        id: "hall-of-fame",
        title: "Hall of Fame",
        className: "cherrypick-ui",
        kind: "performer",
        items: ids.map((id) => ({ performer: { id } })),
        empty: "No champions yet. Settle it with a bracket on the Performers page.",
        link: { to: `${PLUGIN_ROUTE}#hall-of-fame`, text: "View all" },
        extra,
        renderCard: (performer) => /* @__PURE__ */ React.createElement(PerformerCard, { key: performer.id, performer })
      }
    );
  }

  // src/js/ui/dialogs.jsx
  var views = /* @__PURE__ */ new Map();
  var registerDialog = (view2, Component) => views.set(view2, Component);
  var openDialog = (dialog) => store.set({ dialog });
  var closeDialog = () => store.set({ dialog: null });
  var owner = null;
  function DialogHost() {
    const [me] = React2.useState(() => ({}));
    const [, claim] = React2.useState(0);
    React2.useEffect(() => {
      if (!owner) {
        owner = me;
        claim((n) => n + 1);
      }
      return () => {
        if (owner === me) owner = null;
      };
    }, [me]);
    const dialog = useAppState((s) => s.dialog);
    const watching = useAppState((s) => s.watching);
    if (owner !== me || !dialog || watching) return null;
    const View = views.get(dialog.view);
    return View ? /* @__PURE__ */ React2.createElement(View, { ...dialog }) : null;
  }

  // src/js/data/listFilter.js
  function listGender(criteria) {
    const g = criteria?.gender;
    if (!g) return null;
    if (g.modifier === "IS_NULL") return "none";
    if (g.modifier !== "INCLUDES" && g.modifier !== "EQUALS") return null;
    const list = g.value_list?.length ? g.value_list : g.value ? [g.value] : [];
    return list.length === 1 ? list[0] : null;
  }
  var NAMES = {
    filter_favorites: "Favorites",
    performer_favorite: "Favorite performers",
    rating100: "Rating",
    o_counter: "O count",
    play_count: "Play count",
    play_duration: "Play duration",
    scene_count: "Scene count",
    is_missing: "Missing",
    has_markers: "Has markers",
    organized: "Organized",
    interactive: "Interactive",
    // Stash Curator's criteria, as its filter dialog names them
    curator_appeal: "Curator Appeal",
    curator_affinity: "Curator affinity"
  };
  var SYMBOLS = {
    EQUALS: "=",
    NOT_EQUALS: "≠",
    GREATER_THAN: ">",
    LESS_THAN: "<",
    INCLUDES: "",
    INCLUDES_ALL: ""
  };
  var humanize = (type) => NAMES[type] || (type ? type[0].toUpperCase() + type.slice(1).replace(/_/g, " ") : "");
  function criterionLabel(c) {
    const type = c?.criterionOption?.type || "";
    const name = humanize(type);
    const mod = c?.modifier;
    const v = c?.value;
    const not = mod === "EXCLUDES" || mod === "NOT_EQUALS" ? "Not " : "";
    if (type === "custom_fields")
      return (Array.isArray(v) ? v : []).map(
        (f) => [f.field, SYMBOLS[f.modifier] ?? f.modifier, (f.value || []).join(", ")].filter((x) => x !== "").join(" ")
      ).join(", ");
    if (mod === "IS_NULL") return `No ${name.toLowerCase()}`;
    if (mod === "NOT_NULL") return `Has ${name.toLowerCase()}`;
    if (v && Array.isArray(v.items)) {
      const labels = v.items.map((i) => i.label).filter(Boolean);
      if (labels.length) return not + labels.join(", ");
    }
    if (Array.isArray(v) && v.length) return not + v.join(", ");
    if (typeof v === "string" && v) {
      if (v === "true") return name;
      if (v === "false") return `Not ${name.toLowerCase()}`;
      return `${name}: ${v}`;
    }
    if (v && typeof v === "object" && v.value != null) {
      const range = /BETWEEN/.test(mod || "") && v.value2 != null;
      const sym = SYMBOLS[mod] ?? "";
      return range ? `${name} ${not ? "not " : ""}${v.value} to ${v.value2}` : `${name} ${sym ? sym + " " : ""}${v.value}`;
    }
    return name;
  }
  function describeFilter(filter, known = null) {
    const all = filter.makeFilter() || {};
    const dropped = known ? Object.keys(all).filter((k) => !known.has(k)) : [];
    const criteria = Object.fromEntries(
      Object.entries(all).filter(([k]) => !dropped.includes(k))
    );
    const q = filter.searchTerm || "";
    const parts = (filter.criteria || []).map((c) => ({
      type: c?.criterionOption?.type,
      label: criterionLabel(c)
    }));
    const notApplied = dropped.map((k) => `${humanize(k)} not applied`);
    const labels = (withGender) => [
      ...parts.filter(
        (p) => p.label && !dropped.includes(p.type) && (withGender || p.type !== "gender")
      ).map((p) => p.label),
      ...notApplied,
      q ? `"${q}"` : null
    ].filter(Boolean).join(" · ");
    return {
      key: JSON.stringify([criteria, q]),
      criteria,
      q,
      active: parts.length > 0 || !!q,
      count: parts.length,
      gender: listGender(criteria),
      label: labels(false),
      fullLabel: labels(true),
      notApplied
    };
  }
  function parens(json) {
    let inString = false;
    let escape = false;
    let out = "";
    for (const ch of json) {
      if (escape) {
        escape = false;
        out += ch;
        continue;
      }
      if (ch === "\\" && inString) escape = true;
      else if (ch === '"') inString = !inString;
      out += !inString && ch === "{" ? "(" : !inString && ch === "}" ? ")" : ch;
    }
    return out;
  }
  function encodeCriterion(params) {
    let s = encodeURI(parens(JSON.stringify(params)));
    for (const ch of "?#&;=+") s = s.replaceAll(ch, encodeURIComponent(ch));
    return s;
  }
  function listUrl(path, criteria = [], extra = "") {
    const params = [
      ...criteria.map((c) => "c=" + encodeCriterion(c)),
      ...extra ? [extra] : []
    ];
    return params.length ? `${path}?${params.join("&")}` : path;
  }
  var NO_GENDER = { type: "gender", modifier: "IS_NULL" };
  var noGenderUrl = () => listUrl("/performers", [NO_GENDER]);
  var taggerUrl = () => listUrl("/performers", [NO_GENDER], "disp=3");
  var toRateUrl = () => listUrl(
    "/scenes",
    [{ type: "rating100", modifier: "IS_NULL" }],
    "sortby=play_count&sortdir=desc"
  );
  var customFieldUrl = (field) => listUrl("/performers", [
    {
      type: "custom_fields",
      value: [{ field, modifier: "GREATER_THAN", value: [0] }]
    }
  ]);
  function listPlace(kind, pathname) {
    const path = (pathname || "").replace(/\/+$/, "") || "/";
    if (kind === "performer")
      return path === "/performers" ? { place: "performers" } : null;
    if (kind !== "scene") return null;
    if (path === "/scenes") return { place: "scenes" };
    const m = path.match(/^\/performers\/(\d+)(\/|$)/);
    if (m) return { place: "performer-scenes", performerId: m[1] };
    return { place: "scene-list" };
  }

  // src/js/ui/Cherries.jsx
  var PATHS = [
    "M4 8.4a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7ZM12 7.6a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7Z",
    "M3.61 8.56Q4.58 3.73 8.98 1.48L9.62 2.72Q5.82 4.67 4.99 8.84ZM11.01 8.03Q10.44 4.88 8.73 2.51L9.87 1.69Q11.76 4.32 12.39 7.77ZM9 2.4C10.3.5 12.8.2 14.8 1.3 13.4 3 10.9 3.6 9 2.4Z"
  ];
  function Cherries({ className = "", title }) {
    return /* @__PURE__ */ React.createElement(
      "svg",
      {
        className: `cherrypick-mark ${className}`,
        viewBox: "0 0 16 16",
        width: "1em",
        height: "1em",
        "aria-hidden": title ? void 0 : "true",
        role: title ? "img" : void 0
      },
      title ? /* @__PURE__ */ React.createElement("title", null, title) : null,
      PATHS.map((d) => /* @__PURE__ */ React.createElement("path", { key: d, fill: "currentColor", d }))
    );
  }

  // src/js/features/remove.js
  async function performersWithFields() {
    const found = /* @__PURE__ */ new Map();
    for (const field of OWN_FIELDS) {
      const { findPerformers } = await run(PERFORMERS_WITH_FIELD, {
        performer_filter: { custom_fields: [{ field, modifier: "NOT_NULL" }] }
      });
      for (const p of findPerformers.performers) found.set(p.id, p);
    }
    return [...found.values()];
  }
  async function scenesWithFields() {
    const { findScenes } = await run(SCENES_WITH_FIELD, {
      scene_filter: {
        custom_fields: [{ field: PROVISIONAL_FIELD, modifier: "NOT_NULL" }]
      }
    });
    return findScenes.scenes;
  }
  async function removalCounts() {
    return {
      brackets: store.get().brackets.history.length,
      performers: (await performersWithFields()).length,
      scenes: (await scenesWithFields()).length
    };
  }
  async function removePluginData() {
    cancelWrites();
    await tier1.remove();
    const performers = /* @__PURE__ */ new Map();
    for (const p of await performersWithFields()) {
      const remove = ownFieldsOn(p.custom_fields);
      await runMutation(PERFORMER_UPDATE, {
        input: { id: p.id, custom_fields: { remove } }
      });
      const rest = { ...p.custom_fields || {} };
      for (const f of remove) delete rest[f];
      performers.set(p.id, { custom_fields: rest });
    }
    patchLibraryPerformers(performers);
    const scenes = /* @__PURE__ */ new Map();
    for (const s of await scenesWithFields()) {
      const data = await runMutation(SCENE_SET_FIELDS, {
        input: {
          id: s.id,
          custom_fields: { remove: ownFieldsOn(s.custom_fields) }
        }
      });
      scenes.set(s.id, { custom_fields: data.sceneUpdate.custom_fields });
    }
    patchLibraryScenes(scenes);
    await clearTier3();
    local.del(KEYS.signals);
    store.set({
      ...fromConfig(null),
      signals: EMPTY_SIGNALS,
      stashdbData: null,
      stashdbLookups: {},
      recentHidden: [],
      notice: { kind: "removed" }
    });
  }

  // src/js/features/curatorOffer.js
  var OFFER = {
    title: "Stash Curator also scores your cards",
    sub: "Hide Your score on cards? It stays beside the stars on scene pages.",
    hide: "Hide on cards",
    keep: "Keep both"
  };
  function useCuratorEnabled(wanted) {
    const [on, setOn] = React2.useState(null);
    React2.useEffect(() => {
      if (!wanted) return;
      let live = true;
      run(PLUGINS).then(
        ({ plugins }) => live && setOn(curatorEnabled(plugins)),
        () => live && setOn(false)
      );
      return () => {
        live = false;
      };
    }, [wanted]);
    return on;
  }
  function useCuratorOffer(badges) {
    const loaded = useAppState((s) => s.configLoaded);
    const answer = useAppState((s) => s.curatorOffer);
    const wanted = loaded && answer == null && !!badges;
    const curator = useCuratorEnabled(wanted);
    return wanted && offersToHide({ curator, badges, answer });
  }

  // src/js/features/pluginPage.jsx
  var { Button, Modal } = Bootstrap;
  var { Link: Link2 } = ReactRouterDOM;
  var shortDate = (iso) => new Date(iso).toLocaleDateString(void 0, {
    month: "short",
    day: "numeric"
  });
  var sections = [];
  function registerPageSection(id, order, title, Component) {
    sections.push({ id, order, title, Component });
    sections.sort((a, b) => a.order - b.order);
  }
  function Section({ id, title, children }) {
    return /* @__PURE__ */ React2.createElement("div", { className: "setting-section cherrypick-section", id }, /* @__PURE__ */ React2.createElement("h1", null, title), children);
  }
  function SettingRow({ title, sub, children }) {
    return /* @__PURE__ */ React2.createElement("div", { className: "setting" }, /* @__PURE__ */ React2.createElement("div", null, /* @__PURE__ */ React2.createElement("h3", null, title), sub ? /* @__PURE__ */ React2.createElement("div", { className: "sub-heading" }, sub) : null), /* @__PURE__ */ React2.createElement("div", null, children));
  }
  function CuratorOffer() {
    const badges = useAppState((s) => s.settings.badges);
    const answer = useAppState((s) => s.curatorOffer);
    const show = useCuratorOffer(badges);
    const [hid, setHid] = React2.useState(false);
    if (hid && answer === "hide")
      return /* @__PURE__ */ React2.createElement("div", { className: "card setting-card cherrypick-curator-offer" }, /* @__PURE__ */ React2.createElement(
        SettingRow,
        {
          title: "Your score is off on cards",
          sub: "It stays beside the stars on scene pages. Score badges on cards, in Settings › Plugins, brings it back."
        }
      ));
    if (!show) return null;
    return /* @__PURE__ */ React2.createElement("div", { className: "card setting-card cherrypick-curator-offer" }, /* @__PURE__ */ React2.createElement(SettingRow, { title: OFFER.title, sub: OFFER.sub }, /* @__PURE__ */ React2.createElement(
      Button,
      {
        variant: "secondary",
        size: "sm",
        className: "cherrypick-curator-hide",
        onClick: () => {
          setHid(true);
          answerCuratorOffer("hide");
        }
      },
      OFFER.hide
    ), " ", /* @__PURE__ */ React2.createElement(
      Button,
      {
        variant: "secondary",
        size: "sm",
        className: "cherrypick-curator-keep",
        onClick: () => answerCuratorOffer("keep")
      },
      OFFER.keep
    )));
  }
  function YourScore() {
    const M = useAppState((s) => s.M);
    const library = useAppState((s) => s.library);
    const brackets = useAppState((s) => s.brackets);
    const cv = M?.cv;
    const matches2 = M?.matches.count ? `${M.matches.count} match${M.matches.count === 1 ? "" : "es"} in ${sourcesText(M.matches.sources)}` : null;
    let body;
    if (!M)
      body = /* @__PURE__ */ React2.createElement(
        SettingRow,
        {
          title: "Learning your taste…",
          sub: library ? `${PLUGIN_NAME} is building its model from your Stash ratings and plays.` : `${PLUGIN_NAME} is reading your library from Stash.`
        }
      );
    else if (!cv)
      body = /* @__PURE__ */ React2.createElement(
        SettingRow,
        {
          title: `${rateMore(M)} to start`,
          sub: `Your score needs ${MIN_RATED} rated scenes to check its guesses against. Until then, For you goes by your favorites, performer ratings, brackets and plays.${matches2 ? ` It also learns from ${matches2}.` : ""}`
        },
        /* @__PURE__ */ React2.createElement(
          Link2,
          {
            className: "btn btn-secondary btn-sm cherrypick-rate-link",
            to: toRateUrl()
          },
          "Scenes to rate"
        )
      );
    else {
      const decisions = allDecisions({ brackets }).length;
      const from = [
        `${M.fits.rated.length} rated scenes`,
        `${M.fits.watchedUnrated.length} watched but unrated`,
        "your performer ratings"
      ];
      if (decisions) from.push(`${decisions} bracket picks`);
      if (matches2) from.push(matches2);
      body = /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(
        SettingRow,
        {
          title: `${M.gate ? "On" : "Waiting"}: within half a star ${Math.round(cv.withinModel * 10)} times in 10`,
          sub: `On ${cv.n} ratings it hadn't seen, Your score missed by ${cv.maeModel.toFixed(2)}★ on average; your average alone missed by ${cv.maeBase.toFixed(2)}★ (${Math.round(cv.withinBase * 10)} in 10 within half a star). ${M.gate ? "It beats your average, so it shows on cards." : "It stays hidden until it beats your average."}`
        }
      ), /* @__PURE__ */ React2.createElement(
        SettingRow,
        {
          title: "Learning from",
          sub: `${andList(from)}. Display only: it never writes your Stash ratings.`
        }
      ));
    }
    return /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(CuratorOffer, null), /* @__PURE__ */ React2.createElement("div", { className: "card setting-card" }, body));
  }
  function NotInterested() {
    const list = useAppState((s) => s.notInterested);
    return /* @__PURE__ */ React2.createElement("div", { className: "card setting-card" }, list.length ? list.slice().reverse().map((n) => /* @__PURE__ */ React2.createElement(
      SettingRow,
      {
        key: n.sceneId,
        title: /* @__PURE__ */ React2.createElement(React2.Fragment, null, n.title, n.owned ? null : /* @__PURE__ */ React2.createElement(React2.Fragment, null, " ", /* @__PURE__ */ React2.createElement("span", { className: "badge badge-secondary" }, "Not in your library"))),
        sub: `${n.label ? `Shows less of ${n.label}` : "Hidden"} · ${shortDate(n.at)}`
      },
      /* @__PURE__ */ React2.createElement(
        Button,
        {
          variant: "secondary",
          size: "sm",
          onClick: () => undoNotInterested(n.sceneId)
        },
        "Undo"
      )
    )) : /* @__PURE__ */ React2.createElement(
      SettingRow,
      {
        title: "Nothing hidden",
        sub: `Not interested, in the menu on a ${PLUGIN_NAME} pick, hides it and shows less of what made it appear.`
      }
    ));
  }
  function DontLearnList() {
    const list = useAppState((s) => s.dontLearn);
    return /* @__PURE__ */ React2.createElement("div", { className: "card setting-card" }, list.length ? list.slice().reverse().map((n) => /* @__PURE__ */ React2.createElement(
      SettingRow,
      {
        key: n.sceneId,
        title: n.title,
        sub: `Its plays, rating and picks stay out of your picks · ${shortDate(n.at)}`
      },
      /* @__PURE__ */ React2.createElement(
        Button,
        {
          variant: "secondary",
          size: "sm",
          onClick: () => toggleDontLearn({ id: n.sceneId, title: n.title })
        },
        "Learn from it again"
      )
    )) : /* @__PURE__ */ React2.createElement(
      SettingRow,
      {
        title: "Learning from everything you watch",
        sub: `"Don't learn from this", beside a scene's stars or in a pick's menu, keeps a scene out of what ${PLUGIN_NAME} learns.`
      }
    ));
  }
  function Remove() {
    return /* @__PURE__ */ React2.createElement("div", { className: "card setting-card cherrypick-remove-card" }, /* @__PURE__ */ React2.createElement(
      SettingRow,
      {
        title: "Start over",
        sub: `Removes ${NAME_S} settings and history from Stash's configuration, its custom fields from your performers, and its cache in this browser.`
      },
      /* @__PURE__ */ React2.createElement(
        Button,
        {
          variant: "danger",
          size: "sm",
          onClick: () => openDialog({ view: "remove" })
        },
        "Remove ",
        PLUGIN_NAME,
        " data…"
      )
    ));
  }
  function RemoveDialog() {
    const [counts, setCounts] = React2.useState(null);
    const [busy, setBusy] = React2.useState(false);
    React2.useEffect(() => {
      removalCounts().then(setCounts, () => setCounts({}));
    }, []);
    const applied = useAppState((s) => s.applied.length);
    return /* @__PURE__ */ React2.createElement(Modal, { show: true, onHide: closeDialog, className: "cherrypick-ui" }, /* @__PURE__ */ React2.createElement(Modal.Header, { closeButton: true }, /* @__PURE__ */ React2.createElement(Modal.Title, null, "Remove ", PLUGIN_NAME, " data?")), /* @__PURE__ */ React2.createElement(Modal.Body, null, counts ? /* @__PURE__ */ React2.createElement("ul", null, /* @__PURE__ */ React2.createElement("li", null, "Settings, the Hall of Fame (", counts.brackets ?? 0, " brackets), Not interested and Don't learn, from Stash's configuration"), /* @__PURE__ */ React2.createElement("li", null, "Bracket results and provisional marks from", " ", counts.performers ?? 0, " performer", counts.performers === 1 ? "" : "s", " and ", counts.scenes ?? 0, " ", "scene", counts.scenes === 1 ? "" : "s", " (custom fields)"), /* @__PURE__ */ React2.createElement("li", null, "The library copy, the StashDB cache and row history in this browser")) : /* @__PURE__ */ React2.createElement("p", { className: "text-muted" }, "Counting…"), applied ? /* @__PURE__ */ React2.createElement("p", { className: "text-warning" }, "Ratings ", PLUGIN_NAME, " applied stay. Undo them on this page first if you want them gone.") : null), /* @__PURE__ */ React2.createElement(Modal.Footer, null, /* @__PURE__ */ React2.createElement(Button, { variant: "secondary", onClick: closeDialog }, "Cancel"), /* @__PURE__ */ React2.createElement(
      Button,
      {
        variant: "danger",
        disabled: busy || !counts,
        onClick: async () => {
          setBusy(true);
          await removePluginData();
          closeDialog();
        }
      },
      busy ? "Removing…" : "Remove"
    )));
  }
  function PluginPage() {
    const notice = useAppState((s) => s.notice);
    React2.useEffect(() => {
      const id = window.location.hash.slice(1);
      if (id) document.getElementById(id)?.scrollIntoView();
    }, []);
    return /* @__PURE__ */ React2.createElement("div", { className: "container cherrypick-page cherrypick-ui" }, /* @__PURE__ */ React2.createElement("h1", { className: "cherrypick-page-title" }, PLUGIN_NAME, " ", /* @__PURE__ */ React2.createElement(Cherries, null)), /* @__PURE__ */ React2.createElement("p", { className: "text-muted" }, "Settings are in Settings › Plugins › ", PLUGIN_NAME, "."), notice?.kind === "removed" ? /* @__PURE__ */ React2.createElement("div", { className: "alert alert-info" }, PLUGIN_NAME, "'s data is gone. It starts over as if just installed.") : null, sections.map(({ id, title, Component }) => /* @__PURE__ */ React2.createElement(Section, { key: id, id, title }, /* @__PURE__ */ React2.createElement(Safe, { name: `${title} section` }, /* @__PURE__ */ React2.createElement(Component, null)))));
  }
  function registerPluginPage() {
    registerPageSection("your-score", 10, "Your score", YourScore);
    registerPageSection("not-interested", 40, "Not interested", NotInterested);
    registerPageSection("dont-learn", 50, "Don't learn", DontLearnList);
    registerPageSection("remove", 90, `Remove ${PLUGIN_NAME} data`, Remove);
    registerDialog("remove", RemoveDialog);
    register.route(PLUGIN_ROUTE, () => /* @__PURE__ */ React2.createElement(Safe, { name: "plugin page" }, /* @__PURE__ */ React2.createElement(PluginPage, null)));
  }

  // src/js/model/bracketSetup.js
  var GENDER_KEYS = GENDERS.map(([g]) => g);
  var isGender = (g) => GENDER_KEYS.includes(g);
  function liveGender(edits, p) {
    if (!p) return null;
    if (edits && Object.prototype.hasOwnProperty.call(edits, p.id))
      return edits[p.id];
    return p.local ? p.local.gender ?? null : null;
  }
  function poolCounts(M, genderOf2) {
    return Object.fromEntries(
      GENDER_KEYS.map((g) => [
        g,
        performerPool(M, { gender: g, pool: "library" }, genderOf2).length
      ])
    );
  }
  var dominantGender = (counts) => GENDER_KEYS.reduce(
    (best, g) => (counts[g] || 0) > (counts[best] || 0) ? g : best,
    GENDER_KEYS[0]
  );
  function prefs(saved, dominant) {
    const s = saved || {};
    return {
      pool: s.pool === "favorites" || s.pool === "filter" ? s.pool : "library",
      size: DEFAULT_SIZE,
      gender: isGender(s.gender) ? s.gender : dominant
    };
  }
  function quickChoice(saved, dominant, listFilter) {
    const c = prefs(saved, dominant);
    if (listFilter?.active) {
      c.pool = "filter";
      if (isGender(listFilter.gender)) c.gender = listFilter.gender;
    } else if (c.pool === "filter") c.pool = "library";
    return c;
  }
  function sheetChoice(saved, dominant, listFilter, given) {
    const c = { ...prefs(saved, dominant), ...given || {} };
    if (!given && listFilter?.active && isGender(listFilter.gender))
      c.gender = listFilter.gender;
    if (c.pool === "filter" && !listFilter?.active) c.pool = "library";
    return c;
  }
  function genderWhy({ choice, picked, dominant, saved, listFilter }) {
    const remembered = saved?.gender || null;
    if (picked)
      return {
        text: choice.gender === dominant ? "Your largest pool; picking it goes back to following the library" : "Remembered for next time (across browsers)",
        forget: false
      };
    if (listFilter?.active && isGender(listFilter.gender) && listFilter.gender === choice.gender)
      return { text: "From the Performers list's filter", forget: false };
    if (remembered && remembered === choice.gender)
      return {
        text: "Remembered from your last pick",
        forget: remembered !== dominant
      };
    return { text: `${genderLabel(dominant)}: your largest pool`, forget: false };
  }
  function rememberedPrefs(choice, pickedGender, saved, dominant) {
    const s = saved || {};
    const gender = pickedGender ? choice.gender === dominant ? null : choice.gender : s.gender || null;
    return { gender, pool: choice.pool };
  }
  function resolvePerformerPool(M, choice, listFilter, genderOf2) {
    const usingFilter = choice.pool === "filter" && !!listFilter?.active;
    const pool = usingFilter ? "filter" : choice.pool === "favorites" ? "favorites" : "library";
    const ids = performerPool(
      M,
      {
        gender: choice.gender,
        pool,
        filterIds: usingFilter ? listFilter.ids || /* @__PURE__ */ new Set() : null
      },
      genderOf2
    );
    const poolLabel = [
      genderLabel(choice.gender),
      pool === "favorites" ? "favorites" : pool === "filter" ? listFilter.label || null : null
    ].filter(Boolean).join(" · ");
    return { ids, size: resolveSize(choice.size, ids.length), pool, poolLabel };
  }
  var scenePool = (M, ids) => bracketScenes(M).filter((s) => !ids || ids.has(s.id)).map((s) => s.id);
  function championsRoundPool(M, history, gender) {
    const ids = championsOf(history, gender).filter(
      (id) => M.db.performers.get(id)?.local
    );
    return { ids, size: championsRoundSize(ids.length) };
  }
  var placedIds = (r) => r ? [
    r.champion,
    r.finalist,
    ...r.semifinalists || [],
    ...r.quarterfinalists || []
  ].filter(Boolean) : [];
  function restoreFieldsInput(prev) {
    const partial = {};
    const remove = [];
    for (const [k, v] of Object.entries(prev || {}))
      if (v == null) remove.push(k);
      else partial[k] = v;
    const out = {};
    if (Object.keys(partial).length) out.partial = partial;
    if (remove.length) out.remove = remove;
    return out;
  }

  // src/js/features/brackets/actions.js
  var VIEWS = {
    setup: "bracket-setup",
    clipSetup: "bracket-clip-setup",
    genders: "bracket-genders",
    play: "bracket-play",
    challenge: "bracket-challenge",
    result: "bracket-result",
    apply: "bracket-apply"
  };
  var PERFORMER_GENDER = `
  mutation CherryPickSetGender($input: PerformerUpdateInput!) {
    performerUpdate(input: $input) { id gender }
  }
`;
  var PERFORMER_FIELDS = `
  query CherryPickBracketFields($ids: [ID!]) {
    findPerformers(ids: $ids, filter: { per_page: -1 }) {
      performers { id custom_fields }
    }
  }
`;
  var PERFORMER_SET_FIELDS = `
  mutation CherryPickBracketSetFields($input: PerformerUpdateInput!) {
    performerUpdate(input: $input) { id custom_fields }
  }
`;
  var PERFORMER_RATINGS = `
  query CherryPickPerformerRatings($ids: [ID!]) {
    findPerformers(ids: $ids, filter: { per_page: -1 }) {
      performers { id rating100 custom_fields }
    }
  }
`;
  var SCENE_RATINGS = `
  query CherryPickSceneRatings($ids: [ID!]) {
    findScenes(ids: $ids, filter: { per_page: -1 }) {
      scenes { id rating100 custom_fields }
    }
  }
`;
  var PERFORMER_RATE = `
  mutation CherryPickRatePerformer($input: PerformerUpdateInput!) {
    performerUpdate(input: $input) { id rating100 custom_fields }
  }
`;
  var SCENE_RATE = `
  mutation CherryPickRateScene($input: SceneUpdateInput!) {
    sceneUpdate(input: $input) { id rating100 custom_fields }
  }
`;
  function reportError2(e) {
    console.error("CherryPick:", e);
    store.set({ error: String(e?.message || e) });
  }
  var genderOf = (p) => liveGender(store.get().genderEdits, p);
  var poolCountsNow = () => poolCounts(store.get().M, genderOf);
  var dominantNow = () => dominantGender(poolCountsNow());
  var resolvePool = (choice, listFilter) => resolvePerformerPool(store.get().M, choice, listFilter, genderOf);
  async function setPerformerGender(id, gender) {
    const before = store.get().genderEdits || {};
    store.set((s) => ({
      genderEdits: { ...s.genderEdits || {}, [id]: gender }
    }));
    try {
      await runMutation(PERFORMER_GENDER, { input: { id, gender } });
      patchLibraryPerformer(id, { gender });
    } catch (e) {
      store.set((s) => {
        const edits = { ...s.genderEdits || {} };
        if (Object.prototype.hasOwnProperty.call(before, id))
          edits[id] = before[id];
        else delete edits[id];
        return { genderEdits: edits };
      });
      reportError2(e);
    }
  }
  var forgetBracketGender = () => store.set((s) => ({
    bracketPrefs: { ...s.bracketPrefs || {}, gender: null }
  }));
  function begin(b) {
    store.set((s) => ({
      brackets: { ...s.brackets, active: b },
      dialog: { view: VIEWS.play },
      lastFinished: null
    }));
  }
  function startPerformerBracket(choice, listFilter, remember, origin) {
    const s = store.get();
    if (!s.M) return false;
    const r = resolvePool(choice, listFilter);
    if (!r.size) return false;
    if (remember)
      store.set({
        bracketPrefs: rememberedPrefs(
          choice,
          remember.picked,
          s.bracketPrefs,
          dominantNow()
        )
      });
    begin(
      createBracket(s.M, {
        kind: "performer",
        gender: choice.gender,
        poolLabel: r.poolLabel,
        size: r.size,
        ids: r.ids,
        origin: origin || "/performers",
        recent: recentEntrants(s.brackets.history, "performer", choice.gender)
      })
    );
    return true;
  }
  function quickStartPerformers(listFilter) {
    if (!store.get().M) return;
    const choice = quickChoice(
      store.get().bracketPrefs,
      dominantNow(),
      listFilter
    );
    if (!startPerformerBracket(choice, listFilter, null))
      openDialog({ view: VIEWS.setup, listFilter, choice });
  }
  var openPerformerSetup = (listFilter) => openDialog({ view: VIEWS.setup, listFilter });
  var openClipSetup = (pool) => openDialog({ view: VIEWS.clipSetup, ...pool });
  function startClipBracket({ ids, poolLabel, origin, size }) {
    const { M, brackets } = store.get();
    const entrants = M ? clipEntrants(M, ids) : [];
    const slots = M ? clipSize(entrants.length, size) : null;
    if (!slots) return false;
    begin(
      createBracket(M, {
        kind: "clip",
        poolLabel,
        size: slots,
        ids: entrants,
        pool: ids,
        origin: origin || null,
        recent: recentEntrants(brackets.history, "clip")
      })
    );
    return true;
  }
  function quickStartClip(pool) {
    if (!startClipBracket({ ...pool, size: DEFAULT_SIZE })) openClipSetup(pool);
  }
  function startChampionsRound(gender) {
    const s = store.get();
    if (!s.M) return;
    const { ids, size } = championsRoundPool(s.M, s.brackets.history, gender);
    if (!size) return;
    begin(
      createBracket(s.M, {
        kind: "performer",
        gender,
        poolLabel: `${genderLabel(gender)} · Champions round`,
        size,
        ids,
        champions: true
      })
    );
  }
  var fieldWrites = /* @__PURE__ */ new Map();
  function finish(next, result) {
    const done = {
      ...next,
      status: "done",
      finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
      result
    };
    const challenge = challengeFor(store.get().M, done, genderOf);
    const finished = challenge ? { ...done, challenge } : done;
    store.set((s) => ({
      brackets: { active: null, history: [...s.brackets.history, finished] },
      lastFinished: finished.id,
      dialog: { view: VIEWS.result, id: finished.id }
    }));
    if (finished.kind === "performer")
      fieldWrites.set(finished.id, writeFields(finished));
  }
  async function writeFields(b) {
    const written = {};
    const patches = /* @__PURE__ */ new Map();
    try {
      const { findPerformers } = await run(PERFORMER_FIELDS, {
        ids: placedIds(b.result)
      });
      const current3 = Object.fromEntries(
        findPerformers.performers.map((p) => [p.id, p.custom_fields || {}])
      );
      const updates = bracketFieldUpdates(current3, b);
      for (const [id, partial] of Object.entries(updates)) {
        if (!current3[id]) continue;
        const data = await runMutation(PERFORMER_SET_FIELDS, {
          input: { id, custom_fields: { partial } }
        });
        written[id] = Object.fromEntries(
          Object.keys(partial).map((k) => [k, current3[id][k] ?? null])
        );
        patches.set(id, { custom_fields: data.performerUpdate.custom_fields });
      }
    } catch (e) {
      reportError2(e);
    }
    patchLibraryPerformers(patches);
    store.set((s) => ({
      brackets: {
        ...s.brackets,
        history: s.brackets.history.map(
          (x) => x.id === b.id ? { ...x, fieldWrites: written } : x
        )
      }
    }));
    return written;
  }
  async function restoreFields(b) {
    const written = await fieldWrites.get(b.id) || b.fieldWrites || {};
    fieldWrites.delete(b.id);
    const patches = /* @__PURE__ */ new Map();
    for (const [id, prev] of Object.entries(written)) {
      try {
        const data = await runMutation(PERFORMER_SET_FIELDS, {
          input: { id, custom_fields: restoreFieldsInput(prev) }
        });
        patches.set(id, { custom_fields: data.performerUpdate.custom_fields });
      } catch (e) {
        reportError2(e);
      }
    }
    patchLibraryPerformers(patches);
  }
  function updateActive(fn) {
    const a = store.get().brackets.active;
    if (!a) return;
    const next = fn(a);
    if (next === a) return;
    const st = bracketState(next);
    if (st.done) return finish(next, st.result);
    store.set((s) => ({
      brackets: { ...s.brackets, active: { ...next, status: "active" } }
    }));
  }
  var pickWinner = (id) => updateActive((b) => pick(b, id));
  function undoPick() {
    const s = store.get();
    if (s.brackets.active) return updateActive((b) => undo(b));
    const last = s.brackets.history[s.brackets.history.length - 1];
    if (!last || last.id !== s.lastFinished) return;
    const reopened = { ...last, championRating: null };
    delete reopened.fieldWrites;
    delete reopened.result;
    delete reopened.challenge;
    store.set((st) => ({
      brackets: {
        active: {
          ...undo(reopened),
          status: "active",
          finishedAt: null
        },
        history: st.brackets.history.filter((x) => x.id !== last.id)
      },
      lastFinished: null,
      dialog: { view: VIEWS.play }
    }));
    if (last.kind === "performer") restoreFields(last);
  }
  function pauseBracket() {
    store.set((s) => ({
      dialog: null,
      brackets: s.brackets.active ? { ...s.brackets, active: { ...s.brackets.active, status: "paused" } } : s.brackets
    }));
  }
  var resumeBracket = () => openDialog({ view: VIEWS.play });
  var abandonBracket = () => store.set((s) => ({
    brackets: { ...s.brackets, active: null },
    dialog: null
  }));
  function updateFinished(id, fn) {
    store.set((s) => ({
      brackets: {
        ...s.brackets,
        history: s.brackets.history.map((x) => x.id === id ? fn(x) : x)
      }
    }));
  }
  var finishedBracket = (id) => store.get().brackets.history.find((x) => x.id === id);
  function startChallenge(id) {
    updateFinished(id, (b) => ({
      ...skipChallenge(b, false),
      championRating: null
    }));
    openDialog({ view: VIEWS.challenge, id });
  }
  function pickChallenge(id, winner, against) {
    const before = finishedBracket(id);
    updateFinished(id, (b) => challengePick(b, winner, against));
    const after = finishedBracket(id);
    if (after !== before && challengeState(after)?.done)
      openDialog({ view: VIEWS.result, id });
  }
  function undoChallengePick(id) {
    updateFinished(id, challengeUndo);
    openDialog({ view: VIEWS.challenge, id });
  }
  var skipChallenge2 = (id) => updateFinished(id, (b) => skipChallenge(b));
  var leaveChallenge = (id) => openDialog({ view: VIEWS.result, id });
  async function installedRankingPlugins() {
    const { plugins } = await run(PLUGINS);
    return rankingPlugins(plugins);
  }
  async function currentRecords(kind, ids) {
    const rows = kind === "performer" ? (await run(PERFORMER_RATINGS, { ids })).findPerformers.performers : (await run(SCENE_RATINGS, { ids })).findScenes.scenes;
    return new Map(rows.map((x) => [x.id, x]));
  }
  async function setRating(kind, id, rating100, fields) {
    const input = { id, rating100, ...fields ? { custom_fields: fields } : {} };
    const data = kind === "performer" ? (await runMutation(PERFORMER_RATE, { input })).performerUpdate : (await runMutation(SCENE_RATE, { input })).sceneUpdate;
    return { rating100, custom_fields: data.custom_fields };
  }
  var patchRated = (kind, patches) => kind === "performer" ? patchLibraryPerformers(patches) : patchLibraryScenes(patches);
  async function autoApplyBracket(id) {
    const s = store.get();
    const b = s.brackets.history.find((x) => x.id === id);
    if (!b || b.autoApplied || !s.M || !s.settings.autoApply) return;
    updateFinished(id, (x) => ({ ...x, autoApplied: true }));
    const changes2 = ratingProposals(s.M, b).rows.filter((x) => !x.skip && x.to != null).map(proposedChange);
    if (changes2.length) await applyRatingChanges(b, changes2);
  }
  var setChampionRating = (bracketId, rating100) => updateFinished(bracketId, (x) => ({
    ...x,
    championRating: rating100 ?? null
  }));
  async function applyRatingChanges(bracket, changes2) {
    if (!changes2.length) return;
    const kind = bracket.kind;
    const ids = changes2.map((c) => c.id);
    const { write, ranked, changed: changed2 } = writableChanges(
      changes2,
      await currentRecords(kind, ids)
    );
    const done = [];
    const patches = /* @__PURE__ */ new Map();
    try {
      for (const c of write) {
        const provisional = !!c.provisional;
        patches.set(
          c.id,
          await setRating(
            kind,
            c.id,
            c.to,
            provisionalFieldsInput(c.to, provisional, c.fromProvisional)
          )
        );
        done.push({
          id: c.id,
          from: c.from,
          to: c.to,
          provisional,
          fromProvisional: c.fromProvisional
        });
      }
    } catch (e) {
      reportError2(e);
    }
    patchRated(kind, patches);
    if (!done.length && !ranked.length && !changed2.length) return;
    const batch = {
      id: "a" + Date.now().toString(36),
      at: (/* @__PURE__ */ new Date()).toISOString(),
      bracketId: bracket.id,
      kind,
      poolLabel: bracket.poolLabel,
      changes: done,
      kept: ranked.length,
      stale: changed2.length
    };
    store.set((s) => ({ applied: [...s.applied, batch] }));
  }
  async function undoApplied(batchId) {
    const batch = store.get().applied.find((b) => b.id === batchId);
    if (!batch) return;
    let undo2 = batch.changes;
    let kept = batch.kept || 0;
    let changed2 = batch.changed || 0;
    if (undo2.length) {
      try {
        const now = await currentRecords(
          batch.kind,
          undo2.map((c) => c.id)
        );
        const still = undoableChanges(undo2, now);
        undo2 = still.write;
        kept += still.ranked.length;
        changed2 += still.changed.length;
      } catch (e) {
        reportError2(e);
        return;
      }
    }
    const left = [];
    const patches = /* @__PURE__ */ new Map();
    for (const c of undo2) {
      try {
        patches.set(
          c.id,
          await setRating(
            batch.kind,
            c.id,
            c.from ?? null,
            restoreProvisionalInput(c)
          )
        );
      } catch (e) {
        left.push(c);
        reportError2(e);
      }
    }
    patchRated(batch.kind, patches);
    const stays = left.length || kept > (batch.kept || 0) || changed2 > (batch.changed || 0);
    store.set((s) => ({
      applied: stays ? s.applied.map(
        (b) => b.id === batchId ? { ...b, changes: left, kept, changed: changed2 } : b
      ) : s.applied.filter((b) => b.id !== batchId)
    }));
  }
  var dismissApplied = (batchId) => store.set((s) => ({ applied: s.applied.filter((b) => b.id !== batchId) }));

  // src/js/features/brackets/parts.jsx
  var { faPlay } = FontAwesomeSolid;
  var lc = (s) => s ? s[0].toLowerCase() + s.slice(1) : s;
  var plural = (n, one, many = one + "s") => n === 1 ? one : many;
  var BRACKET = "M1 2h4v1.6H2.6v2.6H5v1.6H1Zm0 6.2h4v1.6H2.6v2.6H5V14H1ZM6.5 4.1h3v3.3h2.6V9H9.5v2.9h-3v-1.6h1.4V5.7H6.5Zm7 3.3h1.5V9h-1.5Z";
  function BracketIcon() {
    return /* @__PURE__ */ React.createElement(
      "svg",
      {
        className: "svg-inline--fa fa-icon cherrypick-icon",
        viewBox: "0 0 16 16",
        "aria-hidden": "true"
      },
      /* @__PURE__ */ React.createElement("path", { fill: "currentColor", d: BRACKET })
    );
  }
  function Icon({ icon, className }) {
    const StashIcon = components.Icon;
    return StashIcon ? /* @__PURE__ */ React.createElement(StashIcon, { icon, className }) : null;
  }
  function Dialog({
    title,
    onHide,
    footer,
    children,
    size = "lg",
    className = "",
    headerExtra
  }) {
    const { Modal: Modal3 } = Bootstrap;
    return /* @__PURE__ */ React.createElement(
      Modal3,
      {
        show: true,
        onHide,
        size,
        centered: true,
        scrollable: true,
        animation: false,
        dialogClassName: "cherrypick-modal-phone",
        className: `cherrypick-ui cherrypick-dialog ${className}`
      },
      /* @__PURE__ */ React.createElement(Modal3.Header, { closeButton: true }, /* @__PURE__ */ React.createElement(Modal3.Title, { as: "h5" }, title), headerExtra),
      /* @__PURE__ */ React.createElement(Modal3.Body, null, children),
      footer ? /* @__PURE__ */ React.createElement(Modal3.Footer, null, footer) : null
    );
  }
  function SizePicker({ n, shown, onPick, floor = DEFAULT_SIZE }) {
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("h6", { className: "text-muted" }, "Size"), /* @__PURE__ */ React.createElement("div", { className: "cherrypick-sizes" }, SIZES.map((s) => {
      const need = s === DEFAULT_SIZE ? floor : s;
      const off = n < need;
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          key: s,
          type: "button",
          className: `btn ${shown === s ? "btn-primary" : "btn-secondary"}`,
          "aria-pressed": shown === s,
          disabled: off,
          title: off ? `Needs ${need}; ${n} available` : void 0,
          onClick: () => onPick(s)
        },
        s
      );
    }), /* @__PURE__ */ React.createElement("span", { className: "small text-muted cherrypick-available" }, n, " available")));
  }
  function ByesNote({ n, className = "" }) {
    const byes = clipByes(n);
    return /* @__PURE__ */ React.createElement("p", { className: `small text-muted cherrypick-byes ${className}` }, "Fewer than ", DEFAULT_SIZE, ", so all ", n, " play", byes ? `; ${byes} ${byes === 1 ? "gets a bye" : "get a bye"} in the first round.` : ".");
  }
  function useEntrant(kind) {
    const db2 = useAppState((s) => s.db);
    return (id) => {
      if (!id || !db2) return { name: "", image: null };
      if (kind === "performer") {
        const p = db2.performers.get(id);
        return { name: p?.name || "A removed performer", image: p?.image, p };
      }
      const s = db2.scenes.get(id);
      return { name: s?.title || "A removed scene", image: s?.image, s };
    };
  }
  function BracketTree({ b, st }) {
    const entrant = useEntrant(b.kind);
    return /* @__PURE__ */ React.createElement("div", { className: "cherrypick-tree" }, st.rounds.map((round, ri) => /* @__PURE__ */ React.createElement("div", { className: "cherrypick-tree-round", key: ri }, /* @__PURE__ */ React.createElement("div", { className: "cherrypick-tree-round-name small text-muted" }, roundName(round.length * 2)), /* @__PURE__ */ React.createElement("div", { className: "cherrypick-tree-matches" }, round.map((m, mi) => {
      const isCur = st.current && st.current.round === ri && st.current.index === mi;
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          className: `card cherrypick-tree-match ${isCur ? "border-primary" : ""}`,
          key: mi
        },
        [m.a, m.b].map((id, k) => {
          const e = entrant(id);
          const state = m.winner && id ? m.winner === id ? "font-weight-bold" : "cherrypick-lost" : !id ? "text-muted" : "";
          return /* @__PURE__ */ React.createElement("div", { key: k, className: `cherrypick-tree-slot ${state}` }, e.image ? /* @__PURE__ */ React.createElement("img", { src: e.image, alt: "", loading: "lazy" }) : /* @__PURE__ */ React.createElement("span", { className: "cherrypick-tree-noimg" }), /* @__PURE__ */ React.createElement("span", { className: "cherrypick-tree-label" }, id ? e.name : m.bye ? "bye" : ""));
        })
      );
    })))));
  }
  function ResumePill() {
    const b = useAppState((s) => s.brackets.active);
    const dialog = useAppState((s) => s.dialog);
    if (!b || dialog) return null;
    const st = bracketState(b);
    if (!st.current) return null;
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-primary btn-sm rounded-pill cherrypick-resume-pill cherrypick-ui",
        onClick: resumeBracket,
        title: `${b.poolLabel} · ${st.played} of ${st.totalMatches} picks made`
      },
      /* @__PURE__ */ React.createElement(Icon, { icon: faPlay }),
      /* @__PURE__ */ React.createElement("span", null, "Resume bracket · ", lc(st.roundLabel))
    );
  }

  // src/js/features/brackets/listOps.jsx
  var lists = createStore({ scene: null, performer: null });
  var latest2 = { scene: null, performer: null };
  var seq = 0;
  function report(kind, filter) {
    if (!filter || latest2[kind]?.filter === filter) return;
    latest2[kind] = { filter, seq: ++seq };
    Promise.resolve().then(() => {
      if (lists.get()[kind] !== latest2[kind]) lists.set({ [kind]: latest2[kind] });
    });
  }
  function describe(filter, known) {
    try {
      return describeFilter(filter, known);
    } catch (e) {
      console.error("CherryPick: could not read the list filter", e);
      return null;
    }
  }
  var FILTER_FIELDS = `
  query CherryPickFilterFields($name: String!) {
    __type(name: $name) {
      inputFields { name }
    }
  }
`;
  var FILTER_TYPES = {
    scene: "SceneFilterType",
    performer: "PerformerFilterType"
  };
  var filterFields = {};
  function knownFields(kind) {
    filterFields[kind] ?? (filterFields[kind] = run(FILTER_FIELDS, { name: FILTER_TYPES[kind] }).then(
      (d) => {
        const fields = d.__type?.inputFields;
        return fields ? new Set(fields.map((f) => f.name)) : null;
      },
      (e) => {
        console.error("CherryPick: could not read Stash's filter fields", e);
        return null;
      }
    ));
    return filterFields[kind];
  }
  function useKnownFields(kind) {
    const [known, setKnown] = React2.useState(void 0);
    React2.useEffect(() => {
      let live = true;
      knownFields(kind).then((k) => live && setKnown(k));
      return () => {
        live = false;
      };
    }, [kind]);
    return known;
  }
  var PERFORMER_IDS = `
  query CherryPickListPerformers($filter: FindFilterType, $performer_filter: PerformerFilterType) {
    findPerformers(filter: $filter, performer_filter: $performer_filter) {
      performers { id }
    }
  }
`;
  var SCENE_IDS = `
  query CherryPickListScenes($filter: FindFilterType, $scene_filter: SceneFilterType) {
    findScenes(filter: $filter, scene_filter: $scene_filter) {
      scenes { id }
    }
  }
`;
  var FRESH_MS = 30 * 1e3;
  var matches = /* @__PURE__ */ new Map();
  function matchIds(kind, desc) {
    const key = kind + "|" + desc.key;
    const hit = matches.get(key);
    if (hit && Date.now() - hit.at < FRESH_MS) return hit.ids;
    if (matches.size > 20) matches.delete(matches.keys().next().value);
    const filter = { q: desc.q || void 0, per_page: -1 };
    const ids = kind === "performer" ? run(PERFORMER_IDS, { filter, performer_filter: desc.criteria }).then(
      (d) => new Set(d.findPerformers.performers.map((p) => p.id))
    ) : run(SCENE_IDS, { filter, scene_filter: desc.criteria }).then(
      (d) => new Set(d.findScenes.scenes.map((s) => s.id))
    );
    ids.catch(() => matches.delete(key));
    matches.set(key, { at: Date.now(), ids });
    return ids;
  }
  function reportError3(e) {
    console.error("CherryPick:", e);
    store.set({ error: String(e?.message || e) });
  }
  function errorText(e) {
    const err = e?.networkError?.result?.errors?.[0] || e?.graphQLErrors?.[0];
    if (!err?.message) return String(e?.message || e);
    const where = (err.path || []).filter((p) => p !== "variable").join(".");
    return where ? `${err.message} (${where})` : err.message;
  }
  var failedTitle = (text) => `Can't bracket this list: ${text}`;
  var NOT_READY = "Cherry Pick is still reading your library";
  var withNotes = (title, desc) => title && desc?.notApplied?.length ? [title, ...desc.notApplied].join(" · ") : title;
  function PerformerOps({ desc, pending: pending2 }) {
    const ready = useAppState((s) => !!s.M);
    const active = useAppState((s) => !!s.brackets.active);
    const key = desc?.key;
    const [failed, setFailed] = React2.useState(null);
    React2.useEffect(() => {
      if (!desc?.active) return;
      let live = true;
      matchIds("performer", desc).catch(
        (e) => live && setFailed({ key, text: errorText(e) })
      );
      return () => {
        live = false;
      };
    }, [key]);
    const error = failed && failed.key === key ? failed.text : null;
    const withIds = async () => desc?.active ? { ...desc, ids: await matchIds("performer", desc) } : desc;
    const go = (fn) => () => withIds().then(fn).catch((e) => {
      reportError3(e);
      setFailed({ key, text: errorText(e) });
    });
    const off = !ready || pending2 || !!error;
    return (
      // A disabled button shows no tooltip in some browsers, so the group
      // carries the not-ready title too.
      /* @__PURE__ */ React2.createElement(
        "div",
        {
          className: "btn-group cherrypick-bracket-ops",
          title: ready ? void 0 : NOT_READY
        },
        active ? null : /* @__PURE__ */ React2.createElement(
          "button",
          {
            type: "button",
            className: "btn btn-secondary cherrypick-bracket-button",
            disabled: off,
            title: !ready ? NOT_READY : error ? failedTitle(error) : withNotes(
              desc?.active ? "Bracket the performers in this list" : "Bracket your performers",
              desc
            ),
            onClick: go(quickStartPerformers)
          },
          /* @__PURE__ */ React2.createElement(BracketIcon, null),
          /* @__PURE__ */ React2.createElement("span", null, "Bracket")
        ),
        /* @__PURE__ */ React2.createElement(
          "button",
          {
            type: "button",
            className: "btn btn-link cherrypick-options-link",
            disabled: off,
            title: !ready ? NOT_READY : error ? failedTitle(error) : void 0,
            onClick: go(openPerformerSetup)
          },
          "Options"
        )
      )
    );
  }
  function useListScenes(where, desc, M) {
    const [fetched, setFetched] = React2.useState(null);
    const local2 = where.place === "performer-scenes" && desc && desc.count <= 1 && !desc.q;
    const remote = !!desc?.active && !local2;
    const key = desc?.key;
    React2.useEffect(() => {
      setFetched(null);
      if (!remote) return;
      let live = true;
      matchIds("scene", desc).then(
        (ids) => live && setFetched({ key, ids }),
        (e) => {
          if (!live) return;
          reportError3(e);
          setFetched({ key, error: errorText(e) });
        }
      );
      return () => {
        live = false;
      };
    }, [key, remote]);
    const none = { ids: null, error: null };
    if (!desc || !M) return none;
    if (!desc.active) return { ids: scenePool(M, null), error: null };
    if (local2) {
      const p = M.db.performers.get(where.performerId);
      return {
        ids: scenePool(M, new Set(p?.ownedSceneIds || [])),
        error: null
      };
    }
    if (!fetched || fetched.key !== key) return none;
    return fetched.error ? { ids: null, error: fetched.error } : { ids: scenePool(M, fetched.ids), error: null };
  }
  var cap = (s) => s[0].toUpperCase() + s.slice(1);
  function SceneOps({ where, desc, pathname }) {
    const M = useAppState((s) => s.M);
    const active = useAppState((s) => !!s.brackets.active);
    const { ids, error } = useListScenes(where, desc, M);
    const n = ids ? ids.length : null;
    const ok = n != null && n >= MIN_CLIP_POOL;
    const plays = ids && M ? clipEntrants(M, ids).length : n;
    const unrated = plays != null && plays < n ? " unrated" : "";
    let pool;
    let label;
    let title;
    if (where.place === "performer-scenes") {
      const p = M?.db.performers.get(where.performerId);
      if (!p || !n && !error) return null;
      const her = pronoun(p);
      pool = {
        ids: ids || [],
        poolLabel: [`${p.name}'s scenes`, ...desc?.notApplied || []].join(
          " · "
        ),
        poolNote: `${cap(her)} scenes in your library`,
        short: "",
        origin: pathname
      };
      label = `Bracket ${her} scenes`;
      title = error ? failedTitle(error) : ok ? `A bracket of ${clipPoolPhrase(plays)}${unrated} scenes of ${her}${clipPoolSpread(plays)}` : `Needs ${MIN_CLIP_POOL} scenes; your library has ${n} of ${her}`;
    } else {
      pool = {
        ids: ids || [],
        poolLabel: desc?.active ? desc.fullLabel || "This list" : "All scenes",
        poolNote: "The scenes in this list",
        short: "Widen this list's filter to take in more of them.",
        origin: pathname
      };
      label = "Bracket";
      title = error ? failedTitle(error) : !M ? NOT_READY : n == null ? void 0 : ok ? `Bracket ${clipPoolPhrase(plays)}${unrated} scenes in this list${clipPoolSpread(plays)}` : `Needs ${MIN_CLIP_POOL} scenes in this list`;
    }
    const herTab = where.place === "performer-scenes";
    return /* @__PURE__ */ React2.createElement(
      "div",
      {
        className: "btn-group cherrypick-bracket-ops",
        title: M ? void 0 : NOT_READY
      },
      active && !herTab ? null : /* @__PURE__ */ React2.createElement(
        "button",
        {
          type: "button",
          className: "btn btn-secondary cherrypick-bracket-button",
          disabled: n == null || herTab && active,
          title: error ? title : withNotes(title, desc),
          onClick: () => quickStartClip(pool)
        },
        /* @__PURE__ */ React2.createElement(BracketIcon, null),
        /* @__PURE__ */ React2.createElement("span", null, label)
      ),
      /* @__PURE__ */ React2.createElement(
        "button",
        {
          type: "button",
          className: "btn btn-link cherrypick-options-link",
          disabled: n == null,
          title: !M ? NOT_READY : error ? failedTitle(error) : void 0,
          onClick: () => openClipSetup(pool)
        },
        "Options"
      )
    );
  }
  var findRoot = (anchor) => {
    const prev = anchor?.previousElementSibling;
    if (prev?.classList.contains("item-list-container")) return prev;
    return anchor?.parentElement?.querySelector(".item-list-container") || null;
  };
  function useToolbarSlots(anchor, enabled) {
    const [slots, setSlots] = React2.useState(null);
    React2.useLayoutEffect(() => {
      const host = anchor.current?.parentElement;
      if (!enabled || !host) return;
      const ops = document.createElement("div");
      ops.className = "cherrypick-bracket-slot cherrypick-ui";
      const pill = document.createElement("div");
      pill.className = "cherrypick-pill-slot cherrypick-ui";
      const place = () => {
        const toolbar2 = findRoot(anchor.current)?.querySelector(
          ".filtered-list-toolbar"
        );
        const target = toolbar2?.querySelector(":scope > .list-operations");
        if (!target) return;
        if (target.firstChild !== ops) target.insertBefore(ops, target.firstChild);
        if (toolbar2.nextElementSibling !== pill) toolbar2.after(pill);
      };
      const inPlace = () => ops.isConnected && ops.parentElement.firstChild === ops && pill.previousElementSibling?.classList.contains("filtered-list-toolbar");
      let root = null;
      let toolbar = null;
      const watch = new MutationObserver(() => {
        if (!inPlace()) place();
        observe();
      });
      const observe = () => {
        const r = findRoot(anchor.current);
        const t = r?.querySelector(".filtered-list-toolbar") || null;
        if (r === root && t === toolbar) return;
        root = r;
        toolbar = t;
        watch.disconnect();
        watch.observe(host, { childList: true });
        if (root) watch.observe(root, { childList: true });
        if (toolbar?.parentElement)
          watch.observe(toolbar.parentElement, { childList: true });
        if (toolbar) watch.observe(toolbar, { childList: true, subtree: true });
      };
      place();
      observe();
      setSlots({ ops, pill });
      return () => {
        watch.disconnect();
        ops.remove();
        pill.remove();
      };
    }, [anchor, enabled]);
    return enabled ? slots : null;
  }
  function ListBracket({ kind, since: listStart }) {
    const { pathname } = ReactRouterDOM.useLocation();
    const where = listPlace(kind, pathname);
    const [since] = React2.useState(listStart);
    const entry = useStoreValue(lists, (s) => s[kind]);
    const filter = entry && entry.seq > since ? entry.filter : null;
    const known = useKnownFields(kind);
    const pending2 = !!filter && known === void 0;
    const desc = React2.useMemo(
      () => filter && known !== void 0 ? describe(filter, known) : null,
      [filter, known]
    );
    const anchor = React2.useRef(null);
    const slots = useToolbarSlots(anchor, !!where);
    if (!where) return null;
    return /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement("span", { ref: anchor, hidden: true }), slots ? ReactDOM.createPortal(
      /* @__PURE__ */ React2.createElement(Safe, { name: "bracket buttons" }, kind === "performer" ? /* @__PURE__ */ React2.createElement(PerformerOps, { desc, pending: pending2 }) : /* @__PURE__ */ React2.createElement(SceneOps, { where, desc, pathname })),
      slots.ops
    ) : null, slots && where.place !== "performer-scenes" ? ReactDOM.createPortal(
      /* @__PURE__ */ React2.createElement(Safe, { name: "resume pill" }, /* @__PURE__ */ React2.createElement(ResumePill, null)),
      slots.pill
    ) : null);
  }
  function registerListOps() {
    patch.before("PerformerList", (...args) => {
      report("performer", args[0]?.filter);
      return args;
    });
    patch.before("SceneList", (...args) => {
      report("scene", args[0]?.filter);
      return args;
    });
    patchAfter("FilteredPerformerList", (props, result) => /* @__PURE__ */ React2.createElement(React2.Fragment, null, result, /* @__PURE__ */ React2.createElement(Safe, { name: "performer bracket buttons" }, /* @__PURE__ */ React2.createElement(ListBracket, { kind: "performer", since: seq }))));
    patchAfter("FilteredSceneList", (props, result) => /* @__PURE__ */ React2.createElement(React2.Fragment, null, result, /* @__PURE__ */ React2.createElement(Safe, { name: "scene bracket buttons" }, /* @__PURE__ */ React2.createElement(ListBracket, { kind: "scene", since: seq }))));
  }

  // src/js/stashdb/client.js
  var CACHE_PREFIX = "stashdb:";
  var CACHE_FORMAT = 2;
  var TTL_MS = 7 * 24 * 3600 * 1e3;
  var MAX_AGE_MS = 30 * 24 * 3600 * 1e3;
  var GAP_MS = 1e3;
  var PER_VIEW = 6;
  var TIMEOUT_MS = 20 * 1e3;
  var REST_MS = 10 * 60 * 1e3;
  var NETWORK_REST_MS = 60 * 1e3;
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function createStashdbClient(io) {
    const now = io.now || Date.now;
    const wait = io.wait || sleep;
    const gapMs = io.gapMs ?? GAP_MS;
    const perView = io.perView ?? PER_VIEW;
    const ttlMs = io.ttlMs ?? TTL_MS;
    const maxAgeMs = io.maxAgeMs ?? MAX_AGE_MS;
    const timeoutMs = io.timeoutMs ?? TIMEOUT_MS;
    const log = io.log || (() => {
    });
    let view2 = 0;
    let sent = 0;
    let lastAt = -Infinity;
    let restUntil = 0;
    let refused = false;
    let chain = Promise.resolve();
    const inflight = /* @__PURE__ */ new Map();
    const later = /* @__PURE__ */ new Map();
    const refreshing = /* @__PURE__ */ new Set();
    const stats = { requests: 0, hits: 0, skipped: 0, failed: 0 };
    function rest(ms, why) {
      restUntil = Math.max(restUntil, now() + ms);
      log(`StashDB lookups paused for ${Math.round(ms / 1e3)} s: ${why}`);
    }
    async function send(text, variables, forView) {
      const skip2 = (why) => {
        stats.skipped++;
        log(`StashDB request skipped: ${why}`);
        return null;
      };
      if (refused) return skip2("StashDB refused the key");
      if (forView !== view2) return skip2("the page changed");
      if (now() < restUntil) return skip2("resting");
      if (sent >= perView) return skip2(`${perView} requests this page already`);
      const delay = lastAt + gapMs - now();
      if (delay > 0) await wait(delay);
      if (forView !== view2) return skip2("the page changed");
      sent++;
      stats.requests++;
      lastAt = now();
      try {
        const res = await io.fetch(io.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", ApiKey: io.apiKey },
          body: JSON.stringify({ query: text, variables }),
          // never follow a redirect with the key, never send cookies or the
          // address of the Stash page
          redirect: "error",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (res.status === 401 || res.status === 403) {
          refused = true;
          throw new Error(`HTTP ${res.status}`);
        }
        if (res.status === 429 || res.status >= 500) {
          const after = Number(res.headers?.get?.("Retry-After")) * 1e3;
          rest(Math.max(REST_MS, after || 0), `HTTP ${res.status}`);
          throw new Error(`HTTP ${res.status}`);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (body.errors?.length) {
          const msg = body.errors.map((e) => e.message).join("; ");
          if (/not authori[sz]ed|unauthori[sz]ed|signature|api key/i.test(msg))
            refused = true;
          throw new Error(msg);
        }
        return body.data ?? null;
      } catch (e) {
        stats.failed++;
        if (!refused && now() >= restUntil) rest(NETWORK_REST_MS, String(e));
        log(`StashDB request failed: ${e?.message || e}`);
        return null;
      } finally {
        lastAt = now();
      }
    }
    return {
      stats,
      // A new page view: the per-view count starts again, and requests still
      // queued for the page before are dropped.
      newView() {
        view2++;
        sent = 0;
        later.clear();
      },
      // One GraphQL request, queued behind the others. Resolves to the
      // answer's data, or null (skipped or failed).
      request(text, variables) {
        const forView = view2;
        const p = chain.then(() => send(text, variables, forView));
        chain = p.catch(() => null);
        return p;
      },
      // The cached entry for a lookup if it can be used: { at, data, stale },
      // or null. stale: old enough or in an older format to ask for again.
      async peek(key) {
        const hit = await io.cache.get(CACHE_PREFIX + key);
        if (!hit || typeof hit.at !== "number") return null;
        const age2 = now() - hit.at;
        if (age2 >= maxAgeMs) return null;
        stats.hits++;
        return { ...hit, stale: age2 >= ttlMs || hit.v !== CACHE_FORMAT };
      },
      async put(key, data) {
        const entry = { at: now(), v: CACHE_FORMAT, data };
        await io.cache.set(CACHE_PREFIX + key, entry);
        return entry;
      },
      // Ask for a stale lookup again once this view's own lookups are done:
      // job sends the requests and keeps the answer. One job per key.
      refresh(key, job) {
        if (!later.has(key) && !refreshing.has(key)) later.set(key, job);
      },
      // The refreshes queued for this view, one after another, through the
      // same queue and per-view budget as every request. A new view drops
      // the rest; a refresh that fails leaves the stale entry for next time.
      async revalidate() {
        const forView = view2;
        for (const [key, job] of later) {
          if (forView !== view2) return;
          later.delete(key);
          refreshing.add(key);
          try {
            await job();
          } finally {
            refreshing.delete(key);
          }
        }
      },
      // A lookup through the cache: load() runs on a miss, and later for a
      // stale entry, and resolves to the data to keep (null is kept too:
      // "StashDB has no such scene"), or undefined when the request did not
      // happen or failed (nothing is kept). Two calls for one key share one
      // load. Resolves to the entry { at, data, stale? }, or null.
      cached(key, load) {
        if (inflight.has(key)) return inflight.get(key);
        const keep = async () => {
          const data = await load();
          return data === void 0 ? null : this.put(key, data);
        };
        const p = (async () => {
          const hit = await this.peek(key);
          if (hit?.stale) this.refresh(key, keep);
          return hit || keep();
        })().finally(() => inflight.delete(key));
        inflight.set(key, p);
        return p;
      }
    };
  }

  // src/js/stashdb/merge.js
  function upsert(list, items) {
    if (!items?.length) return list || [];
    const out = [...list || []];
    const at = new Map(out.map((x, i) => [x.id, i]));
    for (const item of items) {
      const fields = Object.fromEntries(
        Object.entries(item).filter(([, v]) => v !== void 0)
      );
      if (at.has(item.id))
        out[at.get(item.id)] = { ...out[at.get(item.id)], ...fields };
      else {
        at.set(item.id, out.length);
        out.push(fields);
      }
    }
    return out;
  }
  function mergeStashdb(prev, part) {
    const base = prev || { scenes: [], performers: [], studios: [] };
    return {
      ...base,
      endpoint: part.endpoint ?? base.endpoint,
      totalScenes: part.totalScenes ?? base.totalScenes,
      scenes: upsert(base.scenes, part.scenes),
      performers: upsert(base.performers, part.performers),
      studios: upsert(base.studios, part.studios)
    };
  }
  var mergeAll = (prev, parts) => parts.reduce((acc, part) => mergeStashdb(acc, part), prev);

  // src/js/stashdb/lookups.js
  var stamp = (key, entry) => `${key}@${entry.at}`;
  var listLoad = (client3, variables) => async () => {
    const data = await client3.request(SCENE_QUERY, variables);
    return data?.queryScenes ?? void 0;
  };
  async function performerScenes(client3, id) {
    const key = "performer-scenes:" + id;
    const entry = await client3.cached(
      key,
      listLoad(client3, performerScenesVariables(id))
    );
    if (!entry) return null;
    return { part: performerPart(id, entry.data), entries: [stamp(key, entry)] };
  }
  async function studioScenes(client3, id) {
    const key = "studio-scenes:" + id;
    const entry = await client3.cached(
      key,
      listLoad(client3, studioScenesVariables(id))
    );
    if (!entry) return null;
    return { part: studioPart(id, entry.data), entries: [stamp(key, entry)] };
  }
  async function fetchScenes(client3, ids) {
    const got = /* @__PURE__ */ new Map();
    for (let i = 0; i < ids.length; i += SCENE_BATCH) {
      const chunk = ids.slice(i, i + SCENE_BATCH);
      const data = await client3.request(
        scenesByIdQuery(chunk.length),
        scenesByIdVariables(chunk)
      );
      if (!data) continue;
      for (const [j, id] of chunk.entries()) {
        const row = data["s" + j];
        got.set(
          id,
          await client3.put("scene:" + id, row ? sceneFromApi(row) : null)
        );
      }
    }
    return got;
  }
  async function scenesById(client3, ids) {
    const scenes = [];
    const entries2 = [];
    const missing = [];
    const stale = [];
    const add2 = (id, entry) => {
      entries2.push(stamp("scene:" + id, entry));
      if (entry.data) scenes.push(entry.data);
    };
    for (const id of [...new Set(ids)]) {
      const hit = await client3.peek("scene:" + id);
      if (!hit) missing.push(id);
      else {
        add2(id, hit);
        if (hit.stale) stale.push(id);
      }
    }
    const got = await fetchScenes(client3, missing);
    for (const id of missing) if (got.has(id)) add2(id, got.get(id));
    if (stale.length)
      client3.refresh(
        "scenes:" + stale.join(","),
        () => fetchScenes(client3, stale)
      );
    const complete = got.size === missing.length;
    if (!complete && !scenes.length) return null;
    return { part: { scenes }, entries: entries2, complete };
  }

  // src/js/stashdb/layer.js
  var SCENE_PERFORMERS = 3;
  var FALLBACK_PERFORMERS = 3;
  var stashdbReady = (s) => !!(s.stashdb?.apiKey && !s.consent?.stashdbOff);
  var client2 = null;
  var clientFor = "";
  function clientOf(s) {
    const id = `${s.stashdb.endpoint}
${s.stashdb.apiKey}`;
    if (!client2 || clientFor !== id) {
      client2 = createStashdbClient({
        endpoint: s.stashdb.endpoint,
        apiKey: s.stashdb.apiKey,
        fetch: (...args) => window.fetch(...args),
        cache,
        log: (text) => console.debug(`${PLUGIN_ID}: ${text}`)
      });
      clientFor = id;
    }
    return client2;
  }
  onLocation(() => client2?.newView());
  function setStatus(key, status) {
    store.set((s) => ({
      stashdbLookups: { ...s.stashdbLookups || {}, [key]: status }
    }));
  }
  var merged = /* @__PURE__ */ new Set();
  async function runPage(key, lookups) {
    const s = store.get();
    if (!stashdbReady(s)) return;
    const cur = s.stashdbLookups?.[key];
    if (cur === "loading" || cur === "done") return;
    setStatus(key, "loading");
    const c = clientOf(s);
    let results = [null];
    try {
      results = await lookups(c);
    } catch (e) {
      console.warn(`${PLUGIN_ID}: StashDB lookup failed`, e);
    }
    const got = results.filter(Boolean);
    const fresh = got.filter((r) => r.entries.some((e) => !merged.has(e)));
    if (fresh.length) {
      for (const r of fresh) r.entries.forEach((e) => merged.add(e));
      store.set((st) => ({
        stashdbData: mergeAll(
          st.stashdbData || null,
          fresh.map((r) => ({ endpoint: st.stashdb?.endpoint, ...r.part }))
        )
      }));
    }
    const whole = got.length === results.length && got.every((r) => r.complete !== false);
    setStatus(
      key,
      !got.length && results.length ? "failed" : whole ? "done" : "partial"
    );
    c.revalidate().catch(
      (e) => console.debug(`${PLUGIN_ID}: StashDB refresh failed`, e)
    );
    setTimeout(pruneOnce, 5e3);
  }
  var performerKey = (stashId) => "performer:" + stashId;
  var lookupPerformer = (stashId) => runPage(performerKey(stashId), async (c) => [
    await performerScenes(c, stashId)
  ]);
  var sceneKey = (sceneId, withStudio) => `scene:${sceneId}${withStudio ? "+studio" : ""}`;
  var lookupScene = (scene, { studio }) => runPage(sceneKey(scene.id, studio), async (c) => {
    const out = [];
    const id = stashdbIdOf(scene.stash_ids);
    let remote = null;
    if (id) {
      const r = await scenesById(c, [id]);
      out.push(r);
      remote = r?.part.scenes.find((x) => x.id === id) || null;
    }
    const performers = [
      ...new Set(
        [
          ...(scene.performers || []).map((p) => stashdbIdOf(p.stash_ids)),
          ...(remote?.performers || []).map((p) => p.id)
        ].filter(Boolean)
      )
    ].slice(0, SCENE_PERFORMERS);
    const studioId = studio ? stashdbIdOf(scene.studio?.stash_ids) || remote?.studio?.id : null;
    out.push(
      ...await Promise.all([
        ...performers.map((p) => performerScenes(c, p)),
        ...studioId ? [studioScenes(c, studioId)] : []
      ])
    );
    return out;
  });
  function lookupFallback(db2, scenes) {
    const count2 = /* @__PURE__ */ new Map();
    for (const s of scenes)
      for (const p of s.performers) {
        const id = db2.performers.get(p.id)?.stashId;
        if (id) count2.set(id, (count2.get(id) || 0) + 1);
      }
    const ids = [...count2].sort((a, b) => b[1] - a[1]).slice(0, FALLBACK_PERFORMERS).map(([id]) => id);
    if (!ids.length) return Promise.resolve();
    return runPage(
      "fallback",
      (c) => Promise.all(ids.map((id) => performerScenes(c, id)))
    );
  }
  function lookupState(s, key) {
    const st = s.stashdbLookups?.[key];
    if (!st) return "idle";
    if (st === "loading") return st;
    if ((s.modelStashdb ?? null) !== (s.stashdbData ?? null)) return "loading";
    return st;
  }
  function usePerformerLookups(stashId, enabled) {
    const ready = useAppState(stashdbReady);
    React2.useEffect(() => {
      if (ready && enabled && stashId) lookupPerformer(stashId);
    }, [ready, enabled, stashId]);
  }
  function useSceneLookups(scene) {
    const ready = useAppState(stashdbReady);
    const row = useAppState(
      (s) => s.settings.showMoreLikeThis && s.settings.outOfLibrary
    );
    const line = useAppState((s) => s.settings.sceneLine);
    const latest3 = React2.useRef(scene);
    latest3.current = scene;
    React2.useEffect(() => {
      if (ready && (row || line)) lookupScene(latest3.current, { studio: row });
    }, [ready, row, line, scene.id]);
    return useAppState((s) => lookupState(s, sceneKey(scene.id, row)));
  }
  function useFallbackLookups(items) {
    const ready = useAppState(stashdbReady);
    const db2 = useAppState((s) => s.db);
    const has2 = !!items?.length;
    React2.useEffect(() => {
      if (ready && has2 && db2)
        lookupFallback(
          db2,
          items.map((it) => it.scene)
        );
    }, [ready, has2, !!db2]);
  }
  var index = { data: void 0, byId: /* @__PURE__ */ new Map() };
  function fetchedScene(s, id) {
    if (index.data !== s.stashdbData)
      index = {
        data: s.stashdbData,
        byId: new Map((s.stashdbData?.scenes || []).map((x) => [x.id, x]))
      };
    return index.byId.get(id) || null;
  }
  async function cacheKeys() {
    return (await cache.keys()).filter(
      (k) => typeof k === "string" && k.startsWith(CACHE_PREFIX)
    );
  }
  async function cacheStats() {
    const keys2 = await cacheKeys();
    if (!keys2.length) return { count: 0, oldest: null };
    const ats = (await cache.getMany(keys2)).map((v) => v?.at).filter((n) => typeof n === "number");
    return { count: keys2.length, oldest: ats.length ? Math.min(...ats) : null };
  }
  async function clearStashdbCache() {
    await cache.delMany(await cacheKeys());
    merged.clear();
    store.set({ stashdbData: null, stashdbLookups: {} });
  }
  var pruned = false;
  async function pruneOnce() {
    if (pruned) return;
    pruned = true;
    const keys2 = await cacheKeys();
    const values = await cache.getMany(keys2);
    const old = keys2.filter(
      (k, i) => !(Date.now() - (values[i]?.at ?? 0) < MAX_AGE_MS)
    );
    if (old.length) await cache.delMany(old);
  }

  // src/js/whisparr/client.js
  var WHISPARR_PLUGIN = "whisparrUpdate";
  var OPERATION = `
  mutation CherryPickWhisparr($args: Map) {
    runPluginOperation(plugin_id: "${WHISPARR_PLUGIN}", args: $args)
  }
`;
  var BATCH_MS = 60;
  var BATCH_MAX = 50;
  var whisparr = createStore({ available: null, scenes: {} });
  var setScene = (id, state) => whisparr.set((s) => ({ scenes: { ...s.scenes, [id]: state } }));
  var setScenes = (states) => whisparr.set((s) => ({ scenes: { ...s.scenes, ...states } }));
  async function operation(args) {
    const data = await runMutation(OPERATION, { args });
    const out = data?.runPluginOperation;
    if (!out || typeof out !== "object") throw new Error("No answer from Whisparr Update");
    if (!out.ok) throw new Error(out.error || "Whisparr Update failed");
    return out.result;
  }
  var toState = (m) => m ? { kind: "have", ...m } : { kind: "none" };
  var availability = null;
  function checkAvailable() {
    availability || (availability = run(PLUGINS).then(
      ({ plugins }) => (plugins || []).some((p) => p.id === WHISPARR_PLUGIN && p.enabled)
    ).catch(() => false).then((available) => {
      whisparr.set({ available });
      return available;
    }));
    return availability;
  }
  var queue = /* @__PURE__ */ new Set();
  var timer = null;
  function flush() {
    timer = null;
    const ids = [...queue].slice(0, BATCH_MAX);
    ids.forEach((id) => queue.delete(id));
    if (queue.size) timer = setTimeout(flush, 0);
    operation({ mode: "status", stash_ids: ids }).then(
      (result) => setScenes(
        Object.fromEntries(ids.map((id) => [id, toState(result?.[id])]))
      )
    ).catch(
      (e) => setScenes(
        Object.fromEntries(
          ids.map((id) => [id, { kind: "error", error: String(e.message || e) }])
        )
      )
    );
  }
  function requestStatus(stashId) {
    if (!stashId || whisparr.get().scenes[stashId]) return;
    setScene(stashId, { kind: "loading" });
    queue.add(stashId);
    timer ?? (timer = setTimeout(flush, BATCH_MS));
  }
  async function addToWhisparr(stashId, title) {
    const before = whisparr.get().scenes[stashId];
    setScene(stashId, { kind: "adding" });
    try {
      const result = await operation({ mode: "add", stash_id: stashId, title });
      setScene(stashId, toState(result));
      return result;
    } catch (e) {
      setScene(stashId, { kind: "error", error: String(e.message || e), before });
      throw e;
    }
  }
  function useWhisparrScene(stashId) {
    const available = useStoreValue(whisparr, (s) => s.available);
    const state = useStoreValue(whisparr, (s) => s.scenes[stashId] || null);
    React2.useEffect(() => {
      checkAvailable();
    }, []);
    React2.useEffect(() => {
      if (available && stashId) requestStatus(stashId);
    }, [available, stashId]);
    if (!available || !stashId) return null;
    return state || { kind: "loading" };
  }

  // src/js/ui/WhisparrButton.jsx
  var {
    faCheck: faCheck2,
    faDownload,
    faExclamationTriangle,
    faHourglassHalf,
    faSearch,
    faSpinner
  } = FontAwesomeSolid;
  function view(state) {
    switch (state.kind) {
      case "loading":
        return { icon: faSpinner, label: "Whisparr", title: "Asking Whisparr…", click: false, spin: true };
      case "adding":
        return { icon: faSpinner, label: "Adding…", title: "Adding to Whisparr and searching", click: false, spin: true };
      case "none":
        return { icon: faDownload, label: "Whisparr", title: "Add to Whisparr, monitored, and search for it", click: true };
      case "have":
        if (state.hasFile)
          return { icon: faCheck2, label: "Downloaded", title: "Whisparr has this scene. Stash picks it up at its next scan.", click: false, variant: "success" };
        if (state.monitored)
          return { icon: faHourglassHalf, label: "Wanted", title: "Monitored in Whisparr. Click to search again.", click: true };
        return { icon: faSearch, label: "In Whisparr", title: "In Whisparr, not monitored. Click to monitor it and search.", click: true };
      case "error":
      default:
        return { icon: faExclamationTriangle, label: "Whisparr", title: `Whisparr Update: ${state.error || "failed"}. Click to try adding again.`, click: true, variant: "warning" };
    }
  }
  function WhisparrButton({ scene }) {
    const { Icon: Icon3 } = components;
    const state = useWhisparrScene(scene.stashId);
    if (!state) return null;
    const v = view(state);
    const icon = v.icon || faDownload;
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: `minimal btn btn-primary cherrypick-whisparr cherrypick-whisparr-${state.kind}${v.variant ? ` text-${v.variant}` : ""}`,
        title: v.title,
        disabled: !v.click,
        onClick: () => addToWhisparr(scene.stashId, scene.title).catch(() => {
        })
      },
      Icon3 ? /* @__PURE__ */ React.createElement(Icon3, { icon, className: v.spin ? "fa-spin" : void 0 }) : null,
      /* @__PURE__ */ React.createElement("span", null, v.label)
    );
  }

  // src/js/ui/StashdbSceneCard.jsx
  var { Link: Link3 } = ReactRouterDOM;
  var { faDatabase, faExternalLinkAlt } = FontAwesomeSolid;
  var EXTERNAL = { target: "_blank", rel: "noopener noreferrer" };
  function fmtDuration(seconds) {
    if (!seconds || seconds < 0) return null;
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor(s % 3600 / 60);
    const pad = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  }
  function StashdbSceneCard({ scene, item, rowId, width, zoom = 1 }) {
    const { Icon: Icon3, TruncatedText } = components;
    const endpoint = useAppState((s) => s.stashdb?.endpoint);
    const studioLocal = useAppState(
      (s) => scene.studio && s.db?.studios.get(scene.studio.id)?.localId || null
    );
    const store2 = storeOf(useAppState((s) => fetchedScene(s, scene.stashId)));
    const studioSite = store2 && /^studio$/i.test(store2.site);
    const url = stashdbPage(endpoint, "scenes", scene.stashId);
    const duration = fmtDuration(scene.duration);
    const icon = (i) => Icon3 ? /* @__PURE__ */ React.createElement(Icon3, { icon: i }) : null;
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        className: `card grid-card scene-card zoom-${zoom} cherrypick-card cherrypick-missing cherrypick-ui`,
        style: width ? { width: `${width}px` } : void 0
      },
      /* @__PURE__ */ React.createElement("div", { className: "thumbnail-section video-section" }, /* @__PURE__ */ React.createElement("a", { href: url, className: "scene-card-link", ...EXTERNAL }, /* @__PURE__ */ React.createElement("div", { className: "scene-card-preview" }, scene.image ? /* @__PURE__ */ React.createElement(
        "img",
        {
          className: "scene-card-preview-image",
          loading: "lazy",
          src: scene.image,
          alt: ""
        }
      ) : null)), duration ? /* @__PURE__ */ React.createElement("div", { className: "scene-specs-overlay" }, /* @__PURE__ */ React.createElement("span", { className: "overlay-duration" }, duration)) : null, scene.studio ? /* @__PURE__ */ React.createElement("div", { className: "studio-overlay" }, studioLocal ? /* @__PURE__ */ React.createElement(Link3, { to: `/studios/${studioLocal}` }, scene.studio.name) : /* @__PURE__ */ React.createElement("span", null, scene.studio.name)) : null, /* @__PURE__ */ React.createElement("span", { className: "badge badge-secondary cherrypick-missing-badge" }, "Not in your library")),
      /* @__PURE__ */ React.createElement("div", { className: "card-section" }, /* @__PURE__ */ React.createElement("a", { href: url, ...EXTERNAL }, /* @__PURE__ */ React.createElement("h5", { className: "card-section-title flex-aligned" }, TruncatedText ? /* @__PURE__ */ React.createElement(TruncatedText, { text: scene.title, lineCount: 2 }) : scene.title)), /* @__PURE__ */ React.createElement("div", { className: "scene-card__details" }, /* @__PURE__ */ React.createElement("span", { className: "scene-card__date" }, scene.date), item?.reason ? /* @__PURE__ */ React.createElement("div", { className: "scene-card__description cherrypick-reason" }, item.reason) : null)),
      /* @__PURE__ */ React.createElement("hr", null),
      /* @__PURE__ */ React.createElement("div", { className: "card-popovers btn-group" }, store2 ? /* @__PURE__ */ React.createElement(
        "a",
        {
          className: "minimal btn btn-primary cherrypick-store-link",
          href: store2.url,
          title: studioSite ? "The scene on its studio's site" : `The scene on ${store2.site}`,
          ...EXTERNAL
        },
        icon(faExternalLinkAlt),
        /* @__PURE__ */ React.createElement("span", null, store2.site)
      ) : null, /* @__PURE__ */ React.createElement(
        "a",
        {
          className: "minimal btn btn-primary cherrypick-stashdb-link",
          href: url,
          title: "Open on StashDB",
          ...EXTERNAL
        },
        icon(faDatabase),
        /* @__PURE__ */ React.createElement("span", null, "StashDB")
      ), /* @__PURE__ */ React.createElement(WhisparrButton, { scene }), item ? /* @__PURE__ */ React.createElement(CardMenu, { item, rowId }) : null)
    );
  }

  // src/js/features/brackets/sheet.js
  var NONE = { frames: [] };
  function parseSprites(text, base) {
    const frames = [];
    let url = null;
    let t = null;
    for (const line of text.split(/\r?\n/)) {
      const time = line.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s+-->/);
      if (time) {
        t = (+time[1] || 0) * 3600 + +time[2] * 60 + +time[3];
        continue;
      }
      const cell = line.match(/^(.+)#xywh=(\d+),(\d+),(\d+),(\d+)\s*$/);
      if (cell && t != null) {
        url || (url = new URL(cell[1], base).href);
        const [x, y, w, h] = cell.slice(2).map(Number);
        frames.push({ t, x, y, w, h });
        t = null;
      }
    }
    if (!frames.length) return NONE;
    return {
      url,
      frames,
      width: Math.max(...frames.map((f) => f.x + f.w)),
      height: Math.max(...frames.map((f) => f.y + f.h))
    };
  }
  var evenly2 = (k, n) => n ? Array.from(
    { length: Math.min(k, n) },
    (_, j) => Math.round((j + 0.5) * n / Math.min(k, n) - 0.5)
  ) : [];
  function nextPair(st) {
    const cur = st.current;
    if (!cur) return [];
    for (let r = cur.round; r < st.rounds.length; r++)
      for (let i = r === cur.round ? cur.index + 1 : 0; i < st.rounds[r].length; i++) {
        const m = st.rounds[r][i];
        if (m.a && m.b && !m.winner) return [m.a, m.b];
      }
    return [];
  }
  var RESOLUTIONS = [
    [4320, "8K"],
    [2880, "5K"],
    [2160, "4K"],
    [1440, "1440p"],
    [1080, "1080p"],
    [720, "720p"],
    [540, "540p"],
    [480, "480p"],
    [360, "360p"],
    [240, "240p"]
  ];
  function resolution(s) {
    const side = Math.min(s.width || Infinity, s.height || Infinity);
    if (!Number.isFinite(side)) return null;
    const hit = RESOLUTIONS.find(([px]) => side >= px * 0.95);
    return hit ? hit[1] : `${side}p`;
  }
  var tagCounts = /* @__PURE__ */ new WeakMap();
  function tagCount(db2) {
    let counts = tagCounts.get(db2);
    if (!counts) {
      counts = /* @__PURE__ */ new Map();
      for (const s of db2.owned)
        for (const t of s.tags) counts.set(t.id, (counts.get(t.id) || 0) + 1);
      tagCounts.set(db2, counts);
    }
    return counts;
  }
  function cardTags(db2, s, n = 8) {
    const counts = tagCount(db2);
    return s.tags.filter((t) => !isPlaceholderTag(t)).sort(
      (a, b) => (counts.get(a.id) || 0) - (counts.get(b.id) || 0) || a.name.localeCompare(b.name)
    ).slice(0, n);
  }

  // src/js/features/brackets/judge.jsx
  var {
    faChevronLeft,
    faChevronRight,
    faMagnifyingGlass,
    faSearch: faSearch2,
    faPlay: faPlay2,
    faStop,
    faUser
  } = FontAwesomeSolid;
  var PICK_SETTLE_MS = 400;
  var lastPickAt = 0;
  function settled() {
    const now = Date.now();
    if (now - lastPickAt < PICK_SETTLE_MS) return false;
    lastPickAt = now;
    return true;
  }
  var looks = /* @__PURE__ */ new Map();
  var sheets = /* @__PURE__ */ new Map();
  var previews = /* @__PURE__ */ new Map();
  var asked = /* @__PURE__ */ new Set();
  var changes = createStore({ n: 0 });
  var changed = () => changes.set((s) => ({ n: s.n + 1 }));
  var useJudgeData = () => useStoreValue(changes, (s) => s.n);
  async function loadSheet(id, vtt) {
    let sheet = NONE;
    try {
      const res = await fetch(vtt);
      if (res.ok) sheet = parseSprites(await res.text(), vtt);
    } catch (e) {
      console.warn("CherryPick: sprite list", e);
    }
    sheets.set(id, sheet);
    if (sheet.url) new Image().src = sheet.url;
    changed();
  }
  function prepareScenes(ids) {
    const missing = ids.filter((id) => id && !asked.has(id));
    if (!missing.length) return;
    for (const id of missing) asked.add(id);
    run(SCENE_LOOK, { ids: missing }).then(
      ({ findScenes }) => {
        const byId = new Map(findScenes.scenes.map((s) => [s.id, s]));
        for (const id of missing) {
          const look = byId.get(id) || null;
          looks.set(id, look);
          if (look?.paths?.vtt) loadSheet(id, look.paths.vtt);
          else sheets.set(id, NONE);
          if (look?.paths?.preview) probePreview(id, look.paths.preview);
        }
        changed();
      },
      (e) => {
        console.warn("CherryPick: scene details", e);
        for (const id of missing) {
          looks.set(id, null);
          sheets.set(id, NONE);
        }
        changed();
      }
    );
  }
  function probePreview(id, url) {
    if (previews.has(id)) return;
    previews.set(id, void 0);
    fetch(url, { headers: { Range: "bytes=0-0" } }).then((res) => {
      res.body?.cancel().catch(() => {
      });
      return res.ok;
    }).catch(() => false).then((ok) => {
      previews.set(id, ok);
      changed();
    });
  }
  var previewSettings = null;
  function loadPreviewSettings() {
    previewSettings || (previewSettings = run(PREVIEW_SETTINGS).then(
      ({ configuration: c }) => ({
        sound: !!c.interface?.soundOnPreview,
        seconds: (c.general?.previewSegments || 0) * (c.general?.previewSegmentDuration || 0)
      }),
      () => ({ sound: false, seconds: 0 })
    ));
    return previewSettings;
  }
  function usePreviewSettings() {
    const [s, setS] = React2.useState(null);
    React2.useEffect(() => {
      let live = true;
      loadPreviewSettings().then((v) => live && setS(v));
      return () => {
        live = false;
      };
    }, []);
    return s;
  }
  var frameCount = (id) => sheets.get(id)?.frames.length || 0;
  function cellStyle(sheet, f) {
    const pos = (at, size, whole) => whole === size ? 0 : at / (whole - size) * 100;
    return {
      backgroundImage: `url("${sheet.url}")`,
      backgroundSize: `${sheet.width / f.w * 100}% ${sheet.height / f.h * 100}%`,
      backgroundPosition: `${pos(f.x, f.w, sheet.width)}% ${pos(f.y, f.h, sheet.height)}%`
    };
  }
  var ratioOf = (sheet) => sheet?.frames.length ? {
    "--cherrypick-frame-ratio": `${sheet.frames[0].w} / ${sheet.frames[0].h}`
  } : void 0;
  var meta = (s) => [
    s.studio?.name,
    s.date ? s.date.slice(0, 4) : null,
    fmtDuration(s.duration),
    resolution(s)
  ].filter(Boolean).join(" · ");
  var sceneOf = (M, id) => M.db.scenes.get(id) || {
    id,
    title: "A removed scene",
    performers: [],
    tags: [],
    image: null,
    duration: null,
    studio: null,
    date: null
  };
  function Faces({ db: db2, performers, max, big = false }) {
    const shown = performers.slice(0, max);
    const more = performers.length - shown.length;
    return /* @__PURE__ */ React2.createElement("div", { className: `cherrypick-faces${big ? " big" : ""}` }, shown.map((p) => {
      const image = db2.performers.get(p.id)?.image;
      return /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-face", key: p.id, title: p.name }, image ? /* @__PURE__ */ React2.createElement("img", { src: image, alt: "", loading: "lazy" }) : /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-face-none" }, faUser ? /* @__PURE__ */ React2.createElement(Icon, { icon: faUser }) : null), /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-face-name" }, p.name));
    }), more > 0 ? /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-face-more small text-muted" }, "+", more) : null);
  }
  function SceneContender({ id, side, onPick, onLook }) {
    const M = useAppState((s2) => s2.M);
    useJudgeData();
    if (!M) return null;
    const s = sceneOf(M, id);
    const sheet = sheets.get(id);
    const title = s.title || "Untitled scene";
    const n = sheet?.frames.length || 0;
    return /* @__PURE__ */ React2.createElement(
      "div",
      {
        className: `card cherrypick-contender clip cherrypick-judge side-${side}`,
        "data-scene": id
      },
      /* @__PURE__ */ React2.createElement(
        "button",
        {
          type: "button",
          className: "cherrypick-cont-img cherrypick-cover-pick",
          onClick: onPick,
          "aria-label": `Pick ${title}`
        },
        s.image ? /* @__PURE__ */ React2.createElement("img", { src: s.image, alt: "" }) : null,
        /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-key badge badge-dark" }, side === "left" ? "←" : "→"),
        s.duration ? /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-runtime badge badge-dark" }, fmtDuration(s.duration)) : null
      ),
      sheet === NONE ? null : /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-sheet", style: ratioOf(sheet) }, n ? evenly2(8, n).map((i) => {
        const t = fmtDuration(sheet.frames[i].t) || "0:00";
        return /* @__PURE__ */ React2.createElement(
          "button",
          {
            type: "button",
            className: "cherrypick-frame",
            key: i,
            "aria-label": `Look closer from ${t}`,
            onClick: () => onLook(i)
          },
          /* @__PURE__ */ React2.createElement(
            "span",
            {
              className: "cherrypick-frame-img",
              style: cellStyle(sheet, sheet.frames[i])
            }
          ),
          /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-frame-t badge badge-dark" }, t)
        );
      }) : [0, 1, 2, 3, 4, 5, 6, 7].map((i) => /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-frame", key: i }))),
      sheet === NONE ? /* @__PURE__ */ React2.createElement("p", { className: "cherrypick-sheet-none small text-muted" }, "No frames: Stash hasn't generated previews for this scene.") : null,
      /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-cont-body" }, /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-cont-title", title }, title), /* @__PURE__ */ React2.createElement("div", { className: "small text-muted cherrypick-cont-meta" }, meta(s)), /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-cont-faces" }, /* @__PURE__ */ React2.createElement(Faces, { db: M.db, performers: s.performers, max: 4 })), /* @__PURE__ */ React2.createElement("div", { className: "small cherrypick-face-names" }, s.performers.map((p) => p.name).join(", ")), /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-cont-tags" }, cardTags(M.db, s).map((t) => /* @__PURE__ */ React2.createElement("span", { className: "tag-item badge badge-secondary", key: t.id }, t.name))), /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-cont-actions" }, /* @__PURE__ */ React2.createElement(Faces, { db: M.db, performers: s.performers, max: 4 }), /* @__PURE__ */ React2.createElement(
        "button",
        {
          type: "button",
          className: "btn btn-secondary cherrypick-look-btn",
          onClick: () => onLook(-1)
        },
        /* @__PURE__ */ React2.createElement(Icon, { icon: faMagnifyingGlass || faSearch2 }),
        /* @__PURE__ */ React2.createElement("span", null, "Look closer")
      ), /* @__PURE__ */ React2.createElement(
        "button",
        {
          type: "button",
          className: "btn btn-primary cherrypick-pick",
          onClick: onPick
        },
        "Pick this"
      )))
    );
  }
  function Scrubber({ sheet, frame, setFrame }) {
    const ref = React2.useRef(null);
    const down = React2.useRef(false);
    const n = sheet.frames.length;
    const at = (e) => {
      const r = ref.current.getBoundingClientRect();
      return Math.max(
        0,
        Math.min(n - 1, Math.floor((e.clientX - r.left) / r.width * n))
      );
    };
    const cur = Math.max(0, frame);
    const pct = (cur + 0.5) / n * 100;
    return /* @__PURE__ */ React2.createElement(
      "div",
      {
        ref,
        className: "cherrypick-scrub",
        role: "slider",
        tabIndex: 0,
        "aria-label": "Scrub through the scene",
        "aria-valuemin": 0,
        "aria-valuemax": n - 1,
        "aria-valuenow": cur,
        "aria-valuetext": fmtDuration(sheet.frames[cur].t) || "0:00",
        onPointerDown: (e) => {
          down.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setFrame(at(e));
        },
        onPointerMove: (e) => {
          if (down.current || e.pointerType === "mouse") setFrame(at(e));
        },
        onPointerUp: () => down.current = false,
        onPointerCancel: () => down.current = false
      },
      /* @__PURE__ */ React2.createElement("div", { className: "progress cherrypick-scrub-track" }, /* @__PURE__ */ React2.createElement(
        "div",
        {
          className: "progress-bar",
          style: { width: frame < 0 ? "0%" : pct + "%" }
        }
      )),
      frame >= 0 ? /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-scrub-thumb", style: { left: pct + "%" } }) : null
    );
  }
  function Details({ text }) {
    const [open, setOpen] = React2.useState(false);
    return /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-insp-details" }, /* @__PURE__ */ React2.createElement("p", { className: `small${open ? "" : " cherrypick-clamp"}` }, text), text.length > 260 ? /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-link btn-sm p-0",
        onClick: () => setOpen(!open)
      },
      open ? "Less" : "More"
    ) : null);
  }
  function TagGroups({ tags }) {
    if (!tags.length) return null;
    const groups = /* @__PURE__ */ new Map();
    for (const t of tags) {
      const k = t.parents?.[0]?.name || "";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    const named = [...groups.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));
    const order = groups.has("") ? [...named, ""] : named;
    const badge = (t) => /* @__PURE__ */ React2.createElement("span", { className: "tag-item badge badge-secondary", key: t.id }, t.name);
    return /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-insp-tags" }, named.length ? order.map((k) => /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-insp-taggroup", key: k || " other" }, /* @__PURE__ */ React2.createElement("div", { className: "small text-muted" }, k || "Other"), /* @__PURE__ */ React2.createElement("div", null, groups.get(k).map(badge)))) : tags.map(badge));
  }
  function SceneInspector({ id, frame, setFrame }) {
    const M = useAppState((s2) => s2.M);
    useJudgeData();
    const settings = usePreviewSettings();
    const [playing, setPlaying] = React2.useState(false);
    const look = looks.get(id);
    const previewUrl = look?.paths?.preview;
    React2.useEffect(() => setPlaying(false), [frame]);
    if (!M) return null;
    const s = sceneOf(M, id);
    const sheet = sheets.get(id);
    const n = sheet?.frames.length || 0;
    const f = frame >= 0 && n ? sheet.frames[Math.min(frame, n - 1)] : null;
    const hasPreview = !!previewUrl && previews.get(id) === true;
    const step = (d) => setFrame(Math.max(-1, Math.min(n - 1, frame + d)));
    const seconds = Math.round(settings?.seconds || 0);
    return /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-inspector", "data-scene": id }, /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-insp-media" }, /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-insp-view" }, playing && hasPreview ? /* @__PURE__ */ React2.createElement(
      "video",
      {
        className: "cherrypick-insp-video",
        src: previewUrl,
        autoPlay: true,
        playsInline: true,
        muted: !settings?.sound,
        onEnded: () => setPlaying(false)
      }
    ) : f ? /* @__PURE__ */ React2.createElement(
      "span",
      {
        className: "cherrypick-insp-frame",
        style: cellStyle(sheet, f)
      }
    ) : s.image ? /* @__PURE__ */ React2.createElement("img", { src: s.image, alt: "" }) : null, n && !playing ? /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-dark rounded-circle cherrypick-insp-step prev",
        "aria-label": "Previous frame",
        disabled: frame < 0,
        onClick: () => step(-1)
      },
      /* @__PURE__ */ React2.createElement(Icon, { icon: faChevronLeft })
    ), /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-dark rounded-circle cherrypick-insp-step next",
        "aria-label": "Next frame",
        disabled: frame >= n - 1,
        onClick: () => step(1)
      },
      /* @__PURE__ */ React2.createElement(Icon, { icon: faChevronRight })
    )) : null, playing ? null : /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-insp-time badge badge-dark" }, f ? `${fmtDuration(f.t) || "0:00"} / ${fmtDuration(s.duration) || "0:00"}` : ["Cover", fmtDuration(s.duration)].filter(Boolean).join(" · "))), n ? /* @__PURE__ */ React2.createElement(Scrubber, { sheet, frame, setFrame }) : sheet === NONE ? /* @__PURE__ */ React2.createElement("p", { className: "small text-muted cherrypick-insp-none" }, "No frames: Stash hasn't generated previews for this scene. The cover and details are all there is to go on.") : null, hasPreview ? /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-insp-preview" }, /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-secondary btn-sm cherrypick-preview-btn",
        onClick: () => setPlaying(!playing)
      },
      /* @__PURE__ */ React2.createElement(Icon, { icon: playing ? faStop : faPlay2 }),
      /* @__PURE__ */ React2.createElement("span", null, playing ? "Stop the preview" : `Play the ${seconds ? `${seconds} s ` : ""}preview`)
    )) : null, n ? /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-insp-grid", style: ratioOf(sheet) }, /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: `cherrypick-frame cherrypick-frame-cover${frame < 0 ? " active" : ""}`,
        onClick: () => setFrame(-1),
        "aria-label": "Cover",
        "aria-pressed": frame < 0
      },
      s.image ? /* @__PURE__ */ React2.createElement("img", { className: "cherrypick-frame-img", src: s.image, alt: "" }) : null,
      /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-frame-t badge badge-dark" }, "Cover")
    ), evenly2(15, n).map((i) => /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        key: i,
        className: `cherrypick-frame${i === frame ? " active" : ""}`,
        onClick: () => setFrame(i),
        "aria-label": `Frame at ${fmtDuration(sheet.frames[i].t) || "0:00"}`,
        "aria-pressed": i === frame
      },
      /* @__PURE__ */ React2.createElement(
        "span",
        {
          className: "cherrypick-frame-img",
          style: cellStyle(sheet, sheet.frames[i])
        }
      ),
      /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-frame-t badge badge-dark" }, fmtDuration(sheet.frames[i].t) || "0:00")
    ))) : null), /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-insp-info" }, /* @__PURE__ */ React2.createElement("h4", { className: "cherrypick-insp-title" }, s.title || "Untitled scene"), /* @__PURE__ */ React2.createElement("div", { className: "small text-muted" }, meta(s)), /* @__PURE__ */ React2.createElement(Faces, { db: M.db, performers: s.performers, max: Infinity, big: true }), look?.details ? /* @__PURE__ */ React2.createElement(Details, { text: look.details }) : null, /* @__PURE__ */ React2.createElement(TagGroups, { tags: look?.tags || s.tags })));
  }
  function useLook(pair) {
    const [look, setLook] = React2.useState(null);
    const looking = look && pair && (look.id === pair[0] || look.id === pair[1]) ? look : null;
    return [looking, setLook];
  }
  var otherOf = (pair, id) => id === pair[0] ? pair[1] : pair[0];
  var stepFrame = (look, d) => ({
    ...look,
    frame: Math.max(-1, Math.min(frameCount(look.id) - 1, look.frame + d))
  });
  var lookClaims = (e) => e.key === "Escape" || e.key === "Enter" && !e.target?.closest?.("button, a, input, select, textarea");
  function lookKey(key, e, { look, setLook, pair, pick: pick2 }) {
    const d = e.shiftKey ? 10 : 1;
    if (key === "Escape") setLook(null);
    else if (key === "ArrowLeft") setLook((x) => x && stepFrame(x, -d));
    else if (key === "ArrowRight") setLook((x) => x && stepFrame(x, d));
    else if (key === "Home") setLook((x) => x && { ...x, frame: -1 });
    else if (key === "End") setLook((x) => x && stepFrame(x, Infinity));
    else if (key === "Enter") pick2(look.id);
    else if (key === "o" || key === "O")
      setLook({ id: otherOf(pair, look.id), frame: -1 });
    else return false;
    return true;
  }
  function LookFooter({ look, setLook, pair, pick: pick2, titleOf: titleOf2 }) {
    const other = otherOf(pair, look.id);
    return /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-secondary cherrypick-insp-back",
        onClick: () => setLook(null)
      },
      /* @__PURE__ */ React2.createElement(Icon, { icon: faChevronLeft }),
      /* @__PURE__ */ React2.createElement("span", null, "Back to the match")
    ), /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-secondary cherrypick-insp-other",
        title: titleOf2(other),
        onClick: () => setLook({ id: other, frame: -1 })
      },
      /* @__PURE__ */ React2.createElement("span", { className: "d-none d-sm-inline" }, "The other scene"),
      /* @__PURE__ */ React2.createElement("span", { className: "d-sm-none" }, "Other scene")
    ), /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-footer-spacer" }), /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-primary cherrypick-insp-pick",
        onClick: () => pick2(look.id)
      },
      "Pick this one"
    ));
  }
  function LookHints({ id }) {
    useJudgeData();
    const frames = frameCount(id) > 0;
    return /* @__PURE__ */ React2.createElement("p", { className: "cherrypick-hints small text-muted" }, /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-hints-keys" }, frames ? /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement("kbd", null, "←"), " ", /* @__PURE__ */ React2.createElement("kbd", null, "→"), " frames (", /* @__PURE__ */ React2.createElement("kbd", null, "Shift"), " for 10) ·", " ") : null, /* @__PURE__ */ React2.createElement("kbd", null, "Enter"), " pick this one · ", /* @__PURE__ */ React2.createElement("kbd", null, "O"), " the other scene ·", " ", /* @__PURE__ */ React2.createElement("kbd", null, "Esc"), " back"), /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-hints-touch" }, frames ? "Drag along the bar to scrub." : ""));
  }
  function MatchHints({ esc }) {
    return /* @__PURE__ */ React2.createElement("p", { className: "cherrypick-hints small text-muted" }, /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-hints-keys" }, /* @__PURE__ */ React2.createElement("kbd", null, "←"), " ", /* @__PURE__ */ React2.createElement("kbd", null, "→"), " pick · ", /* @__PURE__ */ React2.createElement("kbd", null, "1"), " ", /* @__PURE__ */ React2.createElement("kbd", null, "2"), " look closer ·", " ", /* @__PURE__ */ React2.createElement("kbd", null, "U"), " undo · ", /* @__PURE__ */ React2.createElement("kbd", null, "Esc"), " ", esc), /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-hints-touch" }, "Tap a cover to pick it, or a frame to look closer. Close to", " ", esc === "pause" ? "pause" : "go back", "."));
  }

  // src/js/features/brackets/play.jsx
  var { faRotateLeft, faUndo } = FontAwesomeSolid;
  function Contender({ b, id, side, onPick, onLook }) {
    const M = useAppState((s) => s.M);
    if (!M) return null;
    const key = /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-key badge badge-dark" }, side === "left" ? "←" : "→");
    const onKeyDown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onPick();
      }
    };
    if (b.kind === "clip")
      return /* @__PURE__ */ React2.createElement(SceneContender, { id, side, onPick, onLook });
    const p = M.db.performers.get(id);
    const n = p?.local?.scene_count ?? p?.ownedSceneIds.length ?? 0;
    return /* @__PURE__ */ React2.createElement(
      "div",
      {
        role: "button",
        tabIndex: 0,
        className: `card cherrypick-contender performer side-${side}`,
        onClick: onPick,
        onKeyDown
      },
      /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-cont-img" }, p?.image ? /* @__PURE__ */ React2.createElement("img", { src: p.image, alt: "" }) : null, key),
      /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-cont-body" }, /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-cont-title" }, p?.name || "A removed performer"), /* @__PURE__ */ React2.createElement("div", { className: "small text-muted" }, n, " ", plural(n, "scene")))
    );
  }
  var PASS = /* @__PURE__ */ new Set(["Escape", "Tab", "Enter", " "]);
  function usePickKeys(view2, onKey, claims) {
    const latest3 = React2.useRef({ onKey, claims });
    latest3.current = { onKey, claims };
    React2.useEffect(() => {
      const listener = (e) => {
        if (store.get().dialog?.view !== view2) return;
        if (PASS.has(e.key) && !latest3.current.claims?.(e)) return;
        e.stopPropagation();
        if (e.type !== "keydown" || e.altKey || e.ctrlKey || e.metaKey) return;
        if (latest3.current.onKey(e.key, e)) e.preventDefault();
      };
      window.addEventListener("keydown", listener, true);
      window.addEventListener("keypress", listener, true);
      return () => {
        window.removeEventListener("keydown", listener, true);
        window.removeEventListener("keypress", listener, true);
      };
    }, [view2]);
  }
  var isUndoKey = (k) => k === "Backspace" || k === "u" || k === "U";
  function useSceneMatch(kind, pair, next, onPick) {
    const [look, setLook] = useLook(kind === "clip" ? pair : null);
    const pick2 = (id) => {
      if (!pair || id !== pair[0] && id !== pair[1]) return;
      if (kind === "clip" && !settled()) return;
      setLook(null);
      onPick(id);
    };
    const ids = kind === "clip" && pair ? [...pair, ...next] : [];
    React2.useEffect(() => {
      if (ids.length) prepareScenes(ids);
    }, [ids.join()]);
    const onKey = (k, e) => {
      if (look) return lookKey(k, e, { look, setLook, pair, pick: pick2 });
      if (kind === "clip" && pair && (k === "1" || k === "2")) {
        setLook({ id: k === "1" ? pair[0] : pair[1], frame: -1 });
        return true;
      }
      return null;
    };
    const claims = (e) => !!look && lookClaims(e);
    return { look, setLook, pick: pick2, onKey, claims };
  }
  var titleOf = (id) => store.get().M?.db.scenes.get(id)?.title || "the other scene";
  function PlayDialog() {
    const b = useAppState((s) => s.brackets.active);
    const [tree, setTree] = React2.useState(false);
    const [abandoning, setAbandoning] = React2.useState(false);
    const st = b ? bracketState(b) : null;
    const cur = st?.current;
    const pair = cur && !tree ? [cur.a, cur.b] : null;
    const match = useSceneMatch(
      b?.kind,
      pair,
      st && cur ? nextPair(st) : [],
      pickWinner
    );
    const undo2 = () => {
      match.setLook(null);
      undoPick();
    };
    usePickKeys(
      VIEWS.play,
      (k, e) => {
        const taken = match.onKey(k, e);
        if (taken != null) return taken;
        const a = store.get().brackets.active;
        const now = a ? bracketState(a).current : null;
        if (!now) return false;
        if (k === "ArrowLeft") match.pick(now.a);
        else if (k === "ArrowRight") match.pick(now.b);
        else if (isUndoKey(k)) undo2();
        else if (k === "t" || k === "T") setTree((x) => !x);
        else return false;
        return true;
      },
      match.claims
    );
    if (!b || !cur) return null;
    const kind = b.kind === "performer" ? "performers" : "scenes";
    const look = match.look;
    const footer = look ? /* @__PURE__ */ React2.createElement(
      LookFooter,
      {
        look,
        setLook: match.setLook,
        pair,
        pick: match.pick,
        titleOf
      }
    ) : abandoning ? /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-abandon-ask" }, "Abandon this bracket? Its picks are dropped and nothing is recorded."), /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-footer-spacer" }), /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-secondary",
        onClick: () => setAbandoning(false)
      },
      "Keep playing"
    ), /* @__PURE__ */ React2.createElement("button", { type: "button", className: "btn btn-danger", onClick: abandonBracket }, "Abandon")) : /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-secondary",
        disabled: !b.decisions.length,
        onClick: undo2
      },
      /* @__PURE__ */ React2.createElement(Icon, { icon: faRotateLeft || faUndo }),
      /* @__PURE__ */ React2.createElement("span", null, "Undo")
    ), /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: `btn ${tree ? "btn-primary" : "btn-secondary"}`,
        onClick: () => setTree(!tree)
      },
      /* @__PURE__ */ React2.createElement(BracketIcon, null),
      /* @__PURE__ */ React2.createElement("span", null, tree ? "Back to the match" : "Show bracket")
    ), /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-footer-spacer" }), /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-link btn-sm text-muted",
        onClick: () => setAbandoning(true)
      },
      "Abandon"
    ));
    return /* @__PURE__ */ React2.createElement(
      Dialog,
      {
        title: `${b.poolLabel} · ${b.seeds.length} ${kind}`,
        size: "xl",
        onHide: pauseBracket,
        className: `cherrypick-play-modal${look ? " cherrypick-looking" : ""}`,
        headerExtra: /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-round text-muted" }, st.label),
        footer
      },
      /* @__PURE__ */ React2.createElement(
        "div",
        {
          className: "progress cherrypick-progress",
          title: `${st.played} of ${st.totalMatches} picks`
        },
        /* @__PURE__ */ React2.createElement(
          "div",
          {
            className: "progress-bar",
            style: { width: 100 * st.played / st.totalMatches + "%" }
          }
        )
      ),
      b.kind === "clip" && b.seeds.length < DEFAULT_SIZE && cur.round === 0 && !look ? /* @__PURE__ */ React2.createElement(ByesNote, { n: b.seeds.length, className: "cherrypick-play-byes" }) : null,
      tree ? /* @__PURE__ */ React2.createElement(BracketTree, { b, st }) : look ? /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(
        SceneInspector,
        {
          key: look.id,
          id: look.id,
          frame: look.frame,
          setFrame: (frame) => match.setLook({ ...look, frame })
        }
      ), /* @__PURE__ */ React2.createElement(LookHints, { id: look.id })) : /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement("div", { className: `cherrypick-match ${b.kind}` }, /* @__PURE__ */ React2.createElement(
        Contender,
        {
          key: "a" + cur.a,
          b,
          id: cur.a,
          side: "left",
          onPick: () => match.pick(cur.a),
          onLook: (frame) => match.setLook({ id: cur.a, frame })
        }
      ), /* @__PURE__ */ React2.createElement(
        Contender,
        {
          key: "b" + cur.b,
          b,
          id: cur.b,
          side: "right",
          onPick: () => match.pick(cur.b),
          onLook: (frame) => match.setLook({ id: cur.b, frame })
        }
      )), b.kind === "clip" ? /* @__PURE__ */ React2.createElement(MatchHints, { esc: "pause" }) : /* @__PURE__ */ React2.createElement("p", { className: "cherrypick-hints small text-muted" }, /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-hints-keys" }, /* @__PURE__ */ React2.createElement("kbd", null, "←"), " ", /* @__PURE__ */ React2.createElement("kbd", null, "→"), " pick · ", /* @__PURE__ */ React2.createElement("kbd", null, "U"), " undo ·", " ", /* @__PURE__ */ React2.createElement("kbd", null, "Esc"), " pause"), /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-hints-touch" }, "Tap a side to pick it. Close to pause.")))
    );
  }

  // src/js/features/brackets/challenge.jsx
  var { faRotateLeft: faRotateLeft2, faUndo: faUndo2 } = FontAwesomeSolid;
  var sidesOf = (champ, st) => st.beaten.length % 2 ? [st.current, champ] : [champ, st.current];
  var bracketOf = (id) => store.get().brackets.history.find((x) => x.id === id);
  function ChallengeDialog({ id }) {
    const b = useAppState((s) => s.brackets.history.find((x) => x.id === id));
    const entrant = useEntrant(b?.kind || "performer");
    const st = challengeState(b);
    const pair = st?.current ? sidesOf(b.result.champion, st) : null;
    const next = st?.current ? st.rungs.slice(st.beaten.length + 1, st.beaten.length + 2) : [];
    const match = useSceneMatch(
      b?.kind,
      pair,
      next,
      (winner) => pickChallenge(id, winner, challengeState(bracketOf(id)).current)
    );
    usePickKeys(
      VIEWS.challenge,
      (k, e) => {
        const taken = match.onKey(k, e);
        if (taken != null) return taken;
        const now = bracketOf(id);
        const cur = challengeState(now);
        if (!cur?.current) return false;
        const [left2, right2] = sidesOf(now.result.champion, cur);
        if (k === "ArrowLeft") match.pick(left2);
        else if (k === "ArrowRight") match.pick(right2);
        else if (isUndoKey(k)) {
          if (cur.started) undoChallengePick(id);
        } else return false;
        return true;
      },
      match.claims
    );
    if (!st?.current) return null;
    const n = st.rungs.length;
    const i = st.beaten.length;
    const [left, right] = pair;
    const look = match.look;
    return /* @__PURE__ */ React.createElement(
      Dialog,
      {
        title: `Challenge round · ${entrant(b.result.champion).name}`,
        size: "xl",
        onHide: () => leaveChallenge(id),
        className: `cherrypick-play-modal cherrypick-challenge-modal${look ? " cherrypick-looking" : ""}`,
        headerExtra: /* @__PURE__ */ React.createElement("span", { className: "cherrypick-round text-muted" }, n > 1 ? `Favorite ${i + 1} of ${n}` : "Your favorite"),
        footer: look ? /* @__PURE__ */ React.createElement(
          LookFooter,
          {
            look,
            setLook: match.setLook,
            pair,
            pick: match.pick,
            titleOf: (x) => entrant(x).name
          }
        ) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
          "button",
          {
            type: "button",
            className: "btn btn-secondary",
            disabled: !st.started,
            onClick: () => undoChallengePick(id)
          },
          /* @__PURE__ */ React.createElement(Icon, { icon: faRotateLeft2 || faUndo2 }),
          /* @__PURE__ */ React.createElement("span", null, "Undo")
        ), /* @__PURE__ */ React.createElement("span", { className: "cherrypick-footer-spacer" }), /* @__PURE__ */ React.createElement(
          "button",
          {
            type: "button",
            className: "btn btn-link btn-sm text-muted",
            onClick: () => leaveChallenge(id)
          },
          "Back to the champion"
        ))
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          className: "progress cherrypick-progress",
          title: `${i} of ${n} beaten`
        },
        /* @__PURE__ */ React.createElement("div", { className: "progress-bar", style: { width: 100 * i / n + "%" } })
      ),
      look ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
        SceneInspector,
        {
          key: look.id,
          id: look.id,
          frame: look.frame,
          setFrame: (frame) => match.setLook({ ...look, frame })
        }
      ), /* @__PURE__ */ React.createElement(LookHints, { id: look.id })) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: `cherrypick-match ${b.kind}` }, /* @__PURE__ */ React.createElement(
        Contender,
        {
          key: "l" + left,
          b,
          id: left,
          side: "left",
          onPick: () => match.pick(left),
          onLook: (frame) => match.setLook({ id: left, frame })
        }
      ), /* @__PURE__ */ React.createElement(
        Contender,
        {
          key: "r" + right,
          b,
          id: right,
          side: "right",
          onPick: () => match.pick(right),
          onLook: (frame) => match.setLook({ id: right, frame })
        }
      )), b.kind === "clip" ? /* @__PURE__ */ React.createElement(MatchHints, { esc: "back" }) : /* @__PURE__ */ React.createElement("p", { className: "cherrypick-hints small text-muted" }, /* @__PURE__ */ React.createElement("span", { className: "cherrypick-hints-keys" }, /* @__PURE__ */ React.createElement("kbd", null, "←"), " ", /* @__PURE__ */ React.createElement("kbd", null, "→"), " pick · ", /* @__PURE__ */ React.createElement("kbd", null, "U"), " undo ·", " ", /* @__PURE__ */ React.createElement("kbd", null, "Esc"), " back"), /* @__PURE__ */ React.createElement("span", { className: "cherrypick-hints-touch" }, "Tap a side to pick it. Close to go back.")))
    );
  }

  // src/js/features/brackets/results.jsx
  var { Link: Link4 } = ReactRouterDOM;
  var { faCrown, faCheck: faCheck3, faRotateLeft: faRotateLeft3, faTrophy, faUndo: faUndo3 } = FontAwesomeSolid;
  var FIELD_LIST = `${FIELDS2.titles}, ${FIELDS2.best} and ${FIELDS2.last}`;
  var WINNERS_URL = customFieldUrl(FIELDS2.titles);
  var linkTo = (kind, id) => kind === "performer" ? `/performers/${id}` : `/scenes/${id}`;
  function useMoved(bracketId) {
    const M = useAppState((s) => s.M);
    return React2.useMemo(() => {
      if (!bracketId || !M) return null;
      const others = allDecisions(store.get()).filter(
        (d) => d.bracket !== bracketId
      );
      const before = computeWithDecisions(others);
      if (!before) return null;
      return M.db.owned.filter(
        (s) => M.rating(s) == null && Math.abs(M.prediction(s.id).value - before.prediction(s.id).value) >= 0.05
      ).length;
    }, [bracketId, M]);
  }
  function keptText(a) {
    const left = (n, why) => n ? `Left ${n} as ${n === 1 ? "it is" : "they are"}: ${why(n === 1)}.` : "";
    const text = [
      left(a.kept || 0, (one) => `another plugin rates ${one ? "it" : "them"}`),
      left(
        a.stale || 0,
        (one) => `${one ? "its rating" : "their ratings"} changed since the bracket offered ${one ? "one" : "new ones"}`
      ),
      left(
        a.changed || 0,
        (one) => `${one ? "its rating" : "their ratings"} changed since Apply`
      )
    ].filter(Boolean).join(" ");
    return text || null;
  }
  function AppliedButton({ a, className }) {
    const undo2 = a.changes.length > 0;
    return /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className,
        onClick: () => undo2 ? undoApplied(a.id) : dismissApplied(a.id)
      },
      undo2 ? "Undo" : "Dismiss"
    );
  }
  function Applied({ bracketId }) {
    const applied = useAppState((s) => s.applied);
    return applied.filter((a) => a.bracketId === bracketId).map((a) => /* @__PURE__ */ React2.createElement("p", { className: "small cherrypick-applied", key: a.id }, /* @__PURE__ */ React2.createElement(Icon, { icon: faCheck3, className: "text-success" }), " ", a.changes.length ? `Applied ${a.changes.length} ${plural(a.changes.length, "rating")}. ` : "", keptText(a) ? `${keptText(a)} ` : "", /* @__PURE__ */ React2.createElement(
      AppliedButton,
      {
        a,
        className: "btn btn-link btn-sm cherrypick-inline-link"
      }
    )));
  }
  function ChampionStars({ b }) {
    const { RatingSystem } = components;
    const value = b.championRating ?? null;
    const set2 = (v) => setChampionRating(b.id, v ?? null);
    if (RatingSystem)
      return /* @__PURE__ */ React2.createElement(RatingSystem, { value, onSetRating: set2, clickToRate: true });
    return /* @__PURE__ */ React2.createElement(
      "select",
      {
        className: "form-control form-control-sm cherrypick-champ-select",
        value: value ?? "",
        onChange: (e) => set2(e.target.value ? Number(e.target.value) : null)
      },
      /* @__PURE__ */ React2.createElement("option", { value: "" }, "Stars…"),
      [100, 90, 80, 70, 60, 50, 40, 30, 20, 10].map((r) => /* @__PURE__ */ React2.createElement("option", { key: r, value: r }, fmtStars(r / 20), "★"))
    );
  }
  function ChampionPrompt({ b, name, them, auto = false }) {
    const value = b.championRating ?? null;
    const st = challengeState(b);
    return /* @__PURE__ */ React2.createElement("div", { className: "card cherrypick-fixes cherrypick-champ-rate" }, /* @__PURE__ */ React2.createElement("p", { className: "mb-2" }, value != null ? auto ? `${name}: ${fmtStars(value / 20)}★, and the rest move with ${them}.` : `${name}: ${fmtStars(value / 20)}★. Apply to my ratings sets it, and moves the rest with it.` : `How many stars for ${name}? The rest move with ${them}.`), /* @__PURE__ */ React2.createElement(ChampionStars, { b }), st?.skipped ? /* @__PURE__ */ React2.createElement("p", { className: "small mb-0 mt-2" }, /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-link btn-sm cherrypick-inline-link cherrypick-challenge-start",
        onClick: () => startChallenge(b.id)
      },
      "Play the Challenge round instead"
    )) : null);
  }
  function ChallengeCard({ b, st, name, them, proposal, auto }) {
    const entrant = useEntrant(b.kind);
    const n = st.rungs.length;
    const what = b.kind === "performer" ? "performers" : "scenes";
    if (!st.started)
      return /* @__PURE__ */ React2.createElement("div", { className: "card cherrypick-fixes cherrypick-challenge" }, /* @__PURE__ */ React2.createElement("p", { className: "mb-2" }, /* @__PURE__ */ React2.createElement("b", null, "Test ", name, " against your favorites?"), " Optional: the ratings from this bracket are ready without it.", " ", n === 1 ? `One of the ${what} you've rated waits` : `${n} of the ${what} you've rated wait, lowest rated first`, ". Each win measures ", them, " on your own stars and moves the rest with", " ", them, "; a loss ends the round."), /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-fix-actions" }, /* @__PURE__ */ React2.createElement(
        "button",
        {
          type: "button",
          className: "btn btn-secondary cherrypick-challenge-start",
          onClick: () => startChallenge(b.id)
        },
        /* @__PURE__ */ React2.createElement(Icon, { icon: faTrophy || faCrown }),
        /* @__PURE__ */ React2.createElement("span", null, "Test the champion")
      ), /* @__PURE__ */ React2.createElement(
        "button",
        {
          type: "button",
          className: "btn btn-link cherrypick-challenge-skip",
          onClick: () => skipChallenge2(b.id)
        },
        "Rate ",
        them,
        " myself"
      )));
    if (!st.done)
      return /* @__PURE__ */ React2.createElement("div", { className: "card cherrypick-fixes cherrypick-challenge" }, /* @__PURE__ */ React2.createElement("p", { className: "mb-2" }, "Challenge round: ", name, " has beaten ", st.beaten.length, " of ", n, "."), /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-fix-actions" }, /* @__PURE__ */ React2.createElement(
        "button",
        {
          type: "button",
          className: "btn btn-primary cherrypick-challenge-start",
          onClick: () => startChallenge(b.id)
        },
        /* @__PURE__ */ React2.createElement(Icon, { icon: faTrophy || faCrown }),
        /* @__PURE__ */ React2.createElement("span", null, "Go on with the Challenge round")
      )));
    const beat = st.beaten.map((x) => entrant(x).name);
    const lostTo = st.lostTo ? entrant(st.lostTo).name : null;
    const text = st.won ? n === 1 ? `${name} beat your favorite, ${beat[0]}.` : `${name} beat all ${n} of your favorites: ${andList(beat)}.` : beat.length ? `${name} beat ${andList(beat)}, then lost to ${lostTo}.` : `${name} lost to ${lostTo}.`;
    return /* @__PURE__ */ React2.createElement(
      "div",
      {
        className: `card cherrypick-fixes cherrypick-challenge ${st.won ? "cherrypick-challenge-won" : ""}`
      },
      st.won ? /* @__PURE__ */ React2.createElement("p", { className: "mb-2" }, /* @__PURE__ */ React2.createElement("span", { className: "badge badge-warning cherrypick-challenge-badge" }, /* @__PURE__ */ React2.createElement(Icon, { icon: faTrophy || faCrown }), " Beat your favorites")) : null,
      /* @__PURE__ */ React2.createElement("p", { className: "mb-1 cherrypick-challenge-outcome" }, text, proposal ? auto ? ` That puts ${them} at ${fmtStars(proposal.to / 20)}★, and moves the rest with ${them}.` : ` Apply to my ratings sets ${them} at ${fmtStars(proposal.to / 20)}★, and moves the rest with ${them}.` : ""),
      /* @__PURE__ */ React2.createElement("div", null, /* @__PURE__ */ React2.createElement(
        "button",
        {
          type: "button",
          className: "btn btn-link btn-sm cherrypick-inline-link",
          onClick: () => undoChallengePick(b.id)
        },
        "Undo the last pick"
      ))
    );
  }
  function ResultDialog({ id }) {
    const M = useAppState((s) => s.M);
    const history = useAppState((s) => s.brackets.history);
    const active = useAppState((s) => s.brackets.active);
    const lastFinished = useAppState((s) => s.lastFinished);
    const auto = useAppState((s) => !!s.settings.autoApply);
    const rankers = useRankingPlugins(auto);
    const b = history.find((x) => x.id === id);
    const [tree, setTree] = React2.useState(false);
    const [rateOwn, setRateOwn] = React2.useState(false);
    const moved = useMoved(b?.id);
    const entrant = useEntrant(b?.kind || "performer");
    const proposals = React2.useMemo(
      () => b && M ? ratingProposals(M, b) : null,
      [b, M]
    );
    if (!b || !M) return null;
    const r = b.result;
    const isP = b.kind === "performer";
    const champ = entrant(r.champion);
    const word = { her: "she", his: "he" }[pronoun(champ.p)] || "they";
    const them = isP ? { her: "her", his: "him" }[pronoun(champ.p)] || "them" : "it";
    const challenge = challengeState(b);
    const challengeOpen = !!challenge && !challenge.skipped && !challenge.done;
    const ask = !challengeOpen && (!!challenge?.skipped || rateOwn || proposals?.askChampion || b.championRating != null);
    const placed = challenge?.started && challenge.done ? proposals?.rows.find(
      (x) => x.id === r.champion && !x.skip && x.to != null
    ) : null;
    const toSet = auto ? (proposals?.rows || []).filter((x) => !x.skip && x.to != null).length : 0;
    const wins = b.decisions.filter((d) => d.winner === r.champion).length;
    const due = isP && b.gender && !b.champions && !active ? championsRoundPool(M, history, b.gender) : null;
    const written = b.fieldWrites ? Object.keys(b.fieldWrites).length : null;
    const done = /* @__PURE__ */ React2.createElement(Link4, { to: linkTo(b.kind, r.champion), onClick: closeDialog }, champ.name);
    return /* @__PURE__ */ React2.createElement(
      Dialog,
      {
        title: b.champions ? "Champion of champions" : "Champion",
        size: "xl",
        onHide: closeDialog,
        className: "cherrypick-result-modal",
        headerExtra: /* @__PURE__ */ React2.createElement("span", { className: "text-muted cherrypick-round" }, b.poolLabel, " · ", b.seeds.length, " ", isP ? "performers" : "scenes"),
        footer: /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(
          "button",
          {
            type: "button",
            className: "btn btn-secondary",
            onClick: () => setTree(!tree)
          },
          /* @__PURE__ */ React2.createElement(BracketIcon, null),
          /* @__PURE__ */ React2.createElement("span", null, tree ? "Hide bracket" : "Show bracket")
        ), lastFinished === b.id ? /* @__PURE__ */ React2.createElement(
          "button",
          {
            type: "button",
            className: "btn btn-secondary",
            onClick: undoPick
          },
          /* @__PURE__ */ React2.createElement(Icon, { icon: faRotateLeft3 || faUndo3 }),
          /* @__PURE__ */ React2.createElement("span", null, "Undo the final pick")
        ) : null, auto ? null : /* @__PURE__ */ React2.createElement(
          "button",
          {
            type: "button",
            className: "btn btn-secondary cherrypick-apply-open",
            onClick: () => openDialog({ view: VIEWS.apply, id: b.id })
          },
          isP ? "Apply to my performer ratings…" : "Apply to my ratings…"
        ), /* @__PURE__ */ React2.createElement(
          "button",
          {
            type: "button",
            className: "btn btn-primary",
            onClick: closeDialog
          },
          "Done"
        ))
      },
      /* @__PURE__ */ React2.createElement("div", { className: `cherrypick-champion ${isP ? "performer" : "clip"}` }, /* @__PURE__ */ React2.createElement(
        Link4,
        {
          className: "cherrypick-champ-img",
          to: linkTo(b.kind, r.champion),
          onClick: closeDialog
        },
        champ.image ? /* @__PURE__ */ React2.createElement("img", { src: champ.image, alt: "" }) : null,
        /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-crown text-warning" }, /* @__PURE__ */ React2.createElement(Icon, { icon: challenge?.won && faTrophy || faCrown }))
      ), /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-champ-body" }, /* @__PURE__ */ React2.createElement("h2", { className: "cherrypick-champ-name" }, done), /* @__PURE__ */ React2.createElement("p", { className: "text-muted" }, wins, " ", plural(wins, "win"), " on the way to the top.", " ", isP ? `Long may ${word} reign.` : "Long may it reign."), /* @__PURE__ */ React2.createElement("p", { className: "small text-muted" }, "Every pick fed ", NAME_S, " model", moved == null ? "." : `: Your score moved on ${moved} unrated ${plural(moved, "scene")}`, moved != null && isP ? `, and the ${challenge?.won ? "trophy" : "crown"} now sits on ${champ.name}'s card.` : moved != null ? "." : ""), isP ? /* @__PURE__ */ React2.createElement("p", { className: "small text-muted cherrypick-fields-written" }, written == null ? "Saving the results to their performer records…" : written ? `Saved to ${written} performer ${plural(written, "record")} in Stash as ${FIELD_LIST}.` : null, " ", written ? /* @__PURE__ */ React2.createElement(Link4, { to: WINNERS_URL, onClick: closeDialog }, "Performers who have won a bracket") : null) : null, challenge && !challenge.skipped ? /* @__PURE__ */ React2.createElement(
        ChallengeCard,
        {
          b,
          st: challenge,
          name: champ.name,
          them,
          proposal: placed,
          auto
        }
      ) : null, ask ? /* @__PURE__ */ React2.createElement(ChampionPrompt, { b, name: champ.name, them, auto }) : challenge || b.champions ? null : /* @__PURE__ */ React2.createElement("p", { className: "small mb-2" }, /* @__PURE__ */ React2.createElement(
        "button",
        {
          type: "button",
          className: "btn btn-link btn-sm cherrypick-inline-link cherrypick-rate-own",
          onClick: () => setRateOwn(true)
        },
        "Rate ",
        them,
        " myself"
      )), /* @__PURE__ */ React2.createElement(Applied, { bracketId: b.id }), toSet ? /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement("p", { className: "small cherrypick-auto-apply" }, "Closing this sets ", toSet, " ", isP ? "performer " : "", plural(toSet, "rating"), " in Stash. You can undo", " ", toSet === 1 ? "it" : "them", " on", " ", /* @__PURE__ */ React2.createElement(Link4, { to: `${PLUGIN_ROUTE}#hall-of-fame`, onClick: closeDialog }, NAME_S, " page"), "."), /* @__PURE__ */ React2.createElement(RankingWarning, { names: rankers })) : null)),
      /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-podium" }, [
        [r.finalist, "Finalist"],
        ...r.semifinalists.map((x) => [x, "Semifinalist"])
      ].filter(([x]) => x).map(([x, label]) => {
        const e = entrant(x);
        return /* @__PURE__ */ React2.createElement(
          Link4,
          {
            key: x,
            className: `card cherrypick-podium-item ${isP ? "performer" : "clip"}`,
            to: linkTo(b.kind, x),
            onClick: closeDialog
          },
          /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-podium-img" }, e.image ? /* @__PURE__ */ React2.createElement("img", { src: e.image, alt: "" }) : null),
          /* @__PURE__ */ React2.createElement("span", { className: "small text-muted" }, label),
          /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-podium-name" }, e.name)
        );
      })),
      due?.size ? /* @__PURE__ */ React2.createElement("div", { className: "card cherrypick-fixes cherrypick-champions-due" }, /* @__PURE__ */ React2.createElement("p", { className: "mb-2" }, genderLabel(b.gender), " brackets have crowned ", due.ids.length, " ", "different champions. Time to settle it?"), /* @__PURE__ */ React2.createElement("div", null, /* @__PURE__ */ React2.createElement(
        "button",
        {
          type: "button",
          className: "btn btn-primary",
          onClick: () => startChampionsRound(b.gender)
        },
        /* @__PURE__ */ React2.createElement(Icon, { icon: faCrown }),
        /* @__PURE__ */ React2.createElement("span", null, "Champions round (", due.size, ")")
      ))) : null,
      tree ? /* @__PURE__ */ React2.createElement(BracketTree, { b, st: bracketState(b) }) : null
    );
  }
  function useRankingPlugins(wanted = true) {
    const [names2, setNames] = React2.useState(null);
    React2.useEffect(() => {
      if (!wanted) return void 0;
      let live = true;
      installedRankingPlugins().then((n) => live && setNames(n)).catch(() => live && setNames([]));
      return () => {
        live = false;
      };
    }, [wanted]);
    return names2;
  }
  function RankingWarning({ names: names2 }) {
    if (!names2?.length) return null;
    const one = names2.length === 1;
    return /* @__PURE__ */ React2.createElement("p", { className: "alert alert-warning cherrypick-apply-ranking" }, andList(names2), " ", one ? "is" : "are", " installed. ", one ? "Its" : "Their", " ", "rankings start from Stash's ratings, so ", one ? "it" : "they", " will pick up every rating you apply here.");
  }
  function ApplyDialog({ id }) {
    const M = useAppState((s) => s.M);
    const history = useAppState((s) => s.brackets.history);
    const b = history.find((x) => x.id === id);
    const entrant = useEntrant(b?.kind || "performer");
    const rankers = useRankingPlugins();
    const [unchecked, setUnchecked] = React2.useState(() => /* @__PURE__ */ new Set());
    const [busy, setBusy] = React2.useState(false);
    const { rows, askChampion } = React2.useMemo(
      () => b && M ? ratingProposals(M, b) : { rows: [], askChampion: false },
      [b, M]
    );
    if (!b || !M) return null;
    const isP = b.kind === "performer";
    const champ = entrant(b.result.champion);
    const them = isP ? { her: "her", his: "him" }[pronoun(champ.p)] || "them" : "it";
    const open = rows.filter((x) => !x.skip);
    const chosen = open.filter((x) => !unchecked.has(x.id));
    const ranker = rankers?.length === 1 ? rankers[0] : "Another plugin";
    const skipped = (x) => x.skip === "mirrored" ? "Restash's score" : `${ranker} ranks ${isP ? "them" : "it"}`;
    const back2 = () => openDialog({ view: VIEWS.result, id });
    const toggle = (x) => {
      const n = new Set(unchecked);
      if (n.has(x)) n.delete(x);
      else n.add(x);
      setUnchecked(n);
    };
    const apply = async () => {
      setBusy(true);
      await applyRatingChanges(b, chosen.map(proposedChange));
      back2();
    };
    return /* @__PURE__ */ React2.createElement(
      Dialog,
      {
        title: isP ? "Apply to my performer ratings" : "Apply to my ratings",
        onHide: back2,
        className: "cherrypick-apply-modal",
        footer: /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement("button", { type: "button", className: "btn btn-secondary", onClick: back2 }, "Back"), /* @__PURE__ */ React2.createElement(
          "button",
          {
            type: "button",
            className: "btn btn-primary cherrypick-apply-go",
            disabled: !chosen.length || busy,
            onClick: apply
          },
          busy ? "Applying…" : `Apply ${chosen.length} ${plural(chosen.length, "rating")}`
        ))
      },
      /* @__PURE__ */ React2.createElement("p", null, "These are the Stash ratings this bracket would set, from where each finished against ", isP ? "performers" : "scenes", " you've rated", b.sceneAnchors?.length ? " or whose scenes you've rated" : "", ". Your own ratings stay as they are. Untick anything you'd rather keep; you can undo the whole batch afterwards."),
      /* @__PURE__ */ React2.createElement(RankingWarning, { names: rankers }),
      askChampion || b.championRating != null ? /* @__PURE__ */ React2.createElement(ChampionPrompt, { b, name: champ.name, them }) : null,
      rows.length ? /* @__PURE__ */ React2.createElement("table", { className: "table table-sm cherrypick-apply-table" }, /* @__PURE__ */ React2.createElement("thead", null, /* @__PURE__ */ React2.createElement("tr", null, /* @__PURE__ */ React2.createElement("th", null), /* @__PURE__ */ React2.createElement("th", null, isP ? "Performer" : "Scene"), /* @__PURE__ */ React2.createElement("th", { className: "num" }, "Now"), /* @__PURE__ */ React2.createElement("th", { className: "num" }, "After"), /* @__PURE__ */ React2.createElement("th", null, "Why"))), /* @__PURE__ */ React2.createElement("tbody", null, rows.map((x) => /* @__PURE__ */ React2.createElement(
        "tr",
        {
          key: x.id,
          className: x.skip ? "cherrypick-apply-skipped" : void 0
        },
        /* @__PURE__ */ React2.createElement("td", null, /* @__PURE__ */ React2.createElement(
          "input",
          {
            type: "checkbox",
            "aria-label": "Apply to " + entrant(x.id).name,
            checked: !x.skip && !unchecked.has(x.id),
            disabled: !!x.skip,
            onChange: () => toggle(x.id)
          }
        )),
        /* @__PURE__ */ React2.createElement("td", null, entrant(x.id).name),
        /* @__PURE__ */ React2.createElement("td", { className: "num" }, x.from == null ? /* @__PURE__ */ React2.createElement("span", { className: "text-muted" }, "unrated") : x.primed ? /* @__PURE__ */ React2.createElement(
          "span",
          {
            className: "text-muted",
            title: "Set by Ascension's Prime task, not by you"
          },
          "primed"
        ) : x.fromProvisional ? /* @__PURE__ */ React2.createElement(
          "span",
          {
            className: "text-muted",
            title: "Set by an earlier bracket, under its champion's rating"
          },
          fmtStars(x.from / 20),
          "★ provisional"
        ) : fmtStars(x.from / 20) + "★"),
        /* @__PURE__ */ React2.createElement("td", { className: "num" }, x.skip ? /* @__PURE__ */ React2.createElement("span", { className: "text-muted" }, "kept") : /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement("b", null, fmtStars(x.to / 20), "★"), x.provisional ? /* @__PURE__ */ React2.createElement(
          "span",
          {
            className: "small text-muted cherrypick-provisional",
            title: "No rating of yours placed it, so a later bracket can correct it"
          },
          " ",
          "provisional"
        ) : null)),
        /* @__PURE__ */ React2.createElement("td", { className: "small text-muted" }, x.skip ? skipped(x) : x.why)
      )))) : null,
      open.length || askChampion ? null : /* @__PURE__ */ React2.createElement("p", { className: "text-muted" }, "Nothing to set: this bracket has no new ratings to give.")
    );
  }

  // src/js/features/brackets/setup.jsx
  var { Link: Link5 } = ReactRouterDOM;
  function PausedNote() {
    const active = useAppState((s) => s.brackets.active);
    if (!active) return null;
    return /* @__PURE__ */ React2.createElement("p", { className: "small text-muted mt-3 mb-0" }, "Starting replaces your paused bracket (", active.poolLabel, ",", " ", lc(bracketState(active).roundLabel), ").");
  }
  var POOLS = [
    ["library", "My library", "Everyone with a photo and a scene"],
    ["favorites", "Favorites", "Only your favorite performers"],
    ["filter", "Current filter", null]
  ];
  function SetupSheet({ listFilter, choice: given, picked: wasPicked }) {
    const M = useAppState((s) => s.M);
    const saved = useAppState((s) => s.bracketPrefs);
    useAppState((s) => s.genderEdits);
    const lf = listFilter?.active ? listFilter : null;
    const [choice, setChoice] = React2.useState(
      () => M ? sheetChoice(saved, dominantNow(), lf, given) : null
    );
    const [picked, setPicked] = React2.useState(!!wasPicked);
    if (!M || !choice) return null;
    const set2 = (p) => {
      if (p.gender) setPicked(true);
      setChoice({ ...choice, ...p });
    };
    const dominant = dominantNow();
    const r = resolvePool(choice, lf);
    const n = r.ids.length;
    const size = resolveSize(choice.size, n);
    const counts = Object.fromEntries(
      GENDERS.map(([g]) => [
        g,
        resolvePool({ ...choice, gender: g }, lf).ids.length
      ])
    );
    const noGender = genderless(M, genderOf).filter(eligible);
    const why = genderWhy({ choice, picked, dominant, saved, listFilter: lf });
    const start = () => startPerformerBracket({ ...choice, size }, lf, { picked });
    const toGenders = () => openDialog({ view: VIEWS.genders, listFilter: lf, choice, picked });
    return /* @__PURE__ */ React2.createElement(
      Dialog,
      {
        title: "Bracket options",
        onHide: closeDialog,
        footer: /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(
          "button",
          {
            type: "button",
            className: "btn btn-secondary",
            onClick: closeDialog
          },
          "Cancel"
        ), /* @__PURE__ */ React2.createElement(
          "button",
          {
            type: "button",
            className: "btn btn-primary cherrypick-start",
            disabled: !size,
            onClick: start
          },
          size ? `Start a ${size}-performer bracket` : "Start bracket"
        ))
      },
      /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-setup" }, /* @__PURE__ */ React2.createElement("h6", { className: "text-muted" }, "Gender"), /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-chips" }, GENDERS.map(([g, label]) => /* @__PURE__ */ React2.createElement(
        "button",
        {
          key: g,
          type: "button",
          className: `btn btn-sm ${choice.gender === g ? "btn-primary" : "btn-secondary"}`,
          "aria-pressed": choice.gender === g,
          onClick: () => set2({ gender: g })
        },
        label,
        " ",
        /* @__PURE__ */ React2.createElement("span", { className: "badge badge-light" }, counts[g])
      ))), /* @__PURE__ */ React2.createElement("p", { className: "small text-muted cherrypick-gender-why" }, why.text, why.forget ? /* @__PURE__ */ React2.createElement(React2.Fragment, null, ".", " ", /* @__PURE__ */ React2.createElement(
        "button",
        {
          type: "button",
          className: "btn btn-link btn-sm cherrypick-inline-link",
          onClick: () => {
            forgetBracketGender();
            setChoice({ ...choice, gender: dominant });
          }
        },
        "Use your largest pool (",
        genderLabel(dominant),
        ")"
      )) : null), noGender.length ? /* @__PURE__ */ React2.createElement("p", { className: "small text-muted cherrypick-nogender" }, noGender.length, " ", plural(noGender.length, "performer has", "performers have"), " no gender set, so brackets leave them out.", " ", /* @__PURE__ */ React2.createElement(
        "button",
        {
          type: "button",
          className: "btn btn-link btn-sm cherrypick-inline-link",
          onClick: toGenders
        },
        "Set their genders"
      ), " ", "or", " ", /* @__PURE__ */ React2.createElement(Link5, { to: noGenderUrl(), onClick: closeDialog }, "see them in Performers"), ".") : null, /* @__PURE__ */ React2.createElement(SizePicker, { n, shown: size, onPick: (s) => set2({ size: s }) }), /* @__PURE__ */ React2.createElement("h6", { className: "text-muted" }, "Pool"), /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-pools" }, POOLS.map(([k, label, sub]) => /* @__PURE__ */ React2.createElement("div", { key: k, className: "custom-control custom-radio" }, /* @__PURE__ */ React2.createElement(
        "input",
        {
          type: "radio",
          className: "custom-control-input",
          id: "cherrypick-pool-" + k,
          name: "cherrypick-pool",
          checked: choice.pool === k,
          disabled: k === "filter" && !lf,
          onChange: () => set2({ pool: k })
        }
      ), /* @__PURE__ */ React2.createElement(
        "label",
        {
          className: "custom-control-label",
          htmlFor: "cherrypick-pool-" + k
        },
        label,
        " ",
        /* @__PURE__ */ React2.createElement("span", { className: "small text-muted" }, k === "filter" ? lf ? lf.fullLabel : "Filter the Performers list first" : sub)
      )))), /* @__PURE__ */ React2.createElement("p", { className: "small text-muted cherrypick-new-faces" }, "Performers you haven't rated play first. The ones you've rated wait for the champion's optional Challenge round."), !size ? /* @__PURE__ */ React2.createElement(PoolFixes, { gender: choice.gender, n, onSetGenders: toGenders }) : null, /* @__PURE__ */ React2.createElement(PausedNote, null))
    );
  }
  function PoolFixes({ gender, n, onSetGenders }) {
    const stashdb = useAppState((s) => !!s.stashdb);
    return /* @__PURE__ */ React2.createElement("div", { className: "card cherrypick-fixes" }, /* @__PURE__ */ React2.createElement("p", { className: "mb-2" }, /* @__PURE__ */ React2.createElement("b", null, genderLabel(gender), " pool: ", n, " of ", DEFAULT_SIZE, " needed."), " ", "A bracket needs ", DEFAULT_SIZE, " performers with a photo."), /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-fix-actions" }, /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-primary",
        onClick: onSetGenders
      },
      "Set genders"
    ), stashdb ? /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-fix-tagger" }, /* @__PURE__ */ React2.createElement(
      Link5,
      {
        className: "btn btn-link",
        to: taggerUrl(),
        onClick: closeDialog
      },
      "Fill from StashDB"
    ), /* @__PURE__ */ React2.createElement("span", { className: "small text-muted" }, "Stash's Performer Tagger matches performers to StashDB in batches and fills in their gender.")) : null));
  }
  var SHOWN = 24;
  var scenesOf = (p) => p.local?.scene_count ?? p.ownedSceneIds.length;
  function GenderGrid({ listFilter, choice: given, picked }) {
    const M = useAppState((s) => s.M);
    const saved = useAppState((s) => s.bracketPrefs);
    useAppState((s) => s.genderEdits);
    const [ids] = React2.useState(
      () => M ? genderless(M, genderOf).slice().sort((a, b) => !!b.image - !!a.image || scenesOf(b) - scenesOf(a)).map((p) => p.id) : []
    );
    const [skipped, setSkipped] = React2.useState(() => /* @__PURE__ */ new Set());
    const [shown, setShown] = React2.useState(SHOWN);
    if (!M) return null;
    const choice = { ...prefs(saved, dominantNow()), ...given || {} };
    const r = resolvePool(choice, listFilter);
    const size = resolveSize(choice.size, r.ids.length);
    const label = genderLabel(choice.gender);
    const back2 = () => openDialog({ view: VIEWS.setup, listFilter, choice, picked });
    return /* @__PURE__ */ React2.createElement(
      Dialog,
      {
        title: "Set genders",
        size: "xl",
        onHide: closeDialog,
        className: "cherrypick-genders",
        headerExtra: /* @__PURE__ */ React2.createElement(
          "span",
          {
            className: `cherrypick-pool-count badge ${size ? "badge-success" : "badge-secondary"}`,
            "aria-live": "polite"
          },
          label,
          " pool: ",
          r.ids.length,
          size ? ` · ready for ${size}` : ` of ${DEFAULT_SIZE} needed`
        ),
        footer: /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement("button", { type: "button", className: "btn btn-secondary", onClick: back2 }, "Back"), /* @__PURE__ */ React2.createElement(
          "button",
          {
            type: "button",
            className: "btn btn-primary cherrypick-start",
            disabled: !size,
            onClick: () => startPerformerBracket({ ...choice, size }, listFilter, {
              picked: !!picked
            })
          },
          size ? `Start a ${size}-performer bracket` : "Start bracket"
        ))
      },
      /* @__PURE__ */ React2.createElement("p", { className: "text-muted small" }, "Stash has no gender for these performers, so brackets leave them out. Tap a chip to set it in Stash. Nothing is guessed."),
      /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-gender-grid" }, ids.slice(0, shown).map((id) => {
        const p = M.db.performers.get(id);
        if (!p) return null;
        const g = genderOf(p);
        const n = scenesOf(p);
        return /* @__PURE__ */ React2.createElement(
          "div",
          {
            key: id,
            className: `card cherrypick-gender-card ${skipped.has(id) ? "cherrypick-skipped" : ""}`
          },
          /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-gender-img" }, p.local?.image_path ? /* @__PURE__ */ React2.createElement("img", { src: p.local.image_path, alt: "", loading: "lazy" }) : null),
          /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-gender-body" }, /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-gender-name" }, p.name), /* @__PURE__ */ React2.createElement("div", { className: "small text-muted" }, n, " ", plural(n, "scene"), p.image ? "" : " · no photo, so not in brackets"), /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-gender-chips" }, GENDERS.map(([k, l]) => /* @__PURE__ */ React2.createElement(
            "button",
            {
              key: k,
              type: "button",
              className: `btn btn-sm ${g === k ? "btn-primary" : "btn-secondary"}`,
              "aria-pressed": g === k,
              onClick: () => {
                if (g !== k) setPerformerGender(id, k);
                if (skipped.has(id))
                  setSkipped(
                    new Set([...skipped].filter((x) => x !== id))
                  );
              }
            },
            l
          )), /* @__PURE__ */ React2.createElement(
            "button",
            {
              type: "button",
              className: "btn btn-sm btn-link",
              onClick: () => setSkipped(/* @__PURE__ */ new Set([...skipped, id]))
            },
            "Skip"
          )))
        );
      })),
      ids.length > shown ? /* @__PURE__ */ React2.createElement("div", { className: "text-center mt-2" }, /* @__PURE__ */ React2.createElement(
        "button",
        {
          type: "button",
          className: "btn btn-secondary btn-sm",
          onClick: () => setShown(shown + SHOWN)
        },
        "Show ",
        Math.min(SHOWN, ids.length - shown),
        " more of",
        " ",
        ids.length - shown
      )) : null,
      !ids.length ? /* @__PURE__ */ React2.createElement("p", { className: "text-muted" }, "Everyone has a gender. Nice and tidy.") : null
    );
  }
  var an = (n) => [8, 11, 18].includes(n) ? "an" : "a";
  function ClipSetup({ ids, poolLabel, poolNote, short, origin }) {
    const M = useAppState((s) => s.M);
    const [pref, setPref] = React2.useState(DEFAULT_SIZE);
    const n = ids.length;
    const e = M ? clipEntrants(M, ids).length : n;
    const rated = M ? ids.filter((id) => entrantRole(M, "clip", id) === "anchor").length : 0;
    const tooFew = n < MIN_CLIP_POOL;
    const all = e < DEFAULT_SIZE;
    const shown = tooFew ? null : all ? DEFAULT_SIZE : resolveSize(pref, e);
    const plays = all ? e : shown;
    const start = () => startClipBracket({ ids, poolLabel, origin, size: shown });
    return /* @__PURE__ */ React2.createElement(
      Dialog,
      {
        title: "Bracket options",
        onHide: closeDialog,
        className: "cherrypick-clip-dialog",
        footer: /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(
          "button",
          {
            type: "button",
            className: "btn btn-secondary",
            onClick: closeDialog
          },
          "Cancel"
        ), /* @__PURE__ */ React2.createElement(
          "button",
          {
            type: "button",
            className: "btn btn-primary cherrypick-start",
            disabled: tooFew,
            onClick: start
          },
          tooFew ? "Start bracket" : `Start ${an(plays)} ${plays}-scene bracket`
        ))
      },
      /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-setup cherrypick-clip-setup" }, /* @__PURE__ */ React2.createElement(
        SizePicker,
        {
          n: e,
          shown,
          floor: MIN_CLIP_POOL,
          onPick: setPref
        }
      ), all && !tooFew ? /* @__PURE__ */ React2.createElement(ByesNote, { n: e }) : null, /* @__PURE__ */ React2.createElement("h6", { className: "text-muted" }, "Pool"), /* @__PURE__ */ React2.createElement("p", { className: "cherrypick-clip-pool mb-0" }, poolLabel, " ", /* @__PURE__ */ React2.createElement("span", { className: "small text-muted" }, poolNote)), rated ? /* @__PURE__ */ React2.createElement("p", { className: "small text-muted cherrypick-new-faces" }, e < n ? `${rated} ${plural(rated, "scene you've rated sits", "scenes you've rated sit")} out, and the champion can meet ${rated > CHALLENGE_RUNGS ? `up to ${CHALLENGE_RUNGS} of them` : rated === 1 ? "it" : "them"} in an optional Challenge round.` : `Fewer than ${MIN_CLIP_POOL} scenes here have no rating of yours, so the ones you've rated play too.`) : null, tooFew ? /* @__PURE__ */ React2.createElement("div", { className: "card cherrypick-fixes cherrypick-clip-short" }, /* @__PURE__ */ React2.createElement("p", { className: "mb-0" }, /* @__PURE__ */ React2.createElement("b", null, n, " of ", MIN_CLIP_POOL, " needed."), " ", "A scene bracket needs ", MIN_CLIP_POOL, " scenes.", short ? " " + short : "")) : /* @__PURE__ */ React2.createElement(PausedNote, null))
    );
  }

  // src/js/features/brackets/hallOfFamePage.jsx
  var { Link: Link6 } = ReactRouterDOM;
  var { faCrown: faCrown2, faTrophy: faTrophy2 } = FontAwesomeSolid;
  function ChallengeMark({ b }) {
    if (!challengeWon(b)) return null;
    return /* @__PURE__ */ React.createElement("span", { className: "badge badge-warning cherrypick-challenge-badge" }, /* @__PURE__ */ React.createElement(Icon, { icon: faTrophy2 || faCrown2 }), " Beat your favorites");
  }
  var day = (iso) => new Date(iso).toLocaleDateString(void 0, {
    month: "short",
    day: "numeric"
  });
  var when = (iso) => new Date(iso).toLocaleString(void 0, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  var distinct = (ids) => [...new Set(ids.filter(Boolean))];
  var names = (list) => list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  function Cards({ kind, ids }) {
    const ready = useRowComponents();
    const records = useStashRecords(kind, ids);
    const { PerformerCard, SceneCard } = components;
    const Card = kind === "performer" ? PerformerCard : SceneCard;
    if (!ready || !records?.length || !Card) return null;
    return /* @__PURE__ */ React.createElement("div", { className: "cherrypick-hof-grid" }, records.map(
      (r) => kind === "performer" ? /* @__PURE__ */ React.createElement(Card, { key: r.id, performer: r, zoomIndex: 0, cardWidth: 200 }) : /* @__PURE__ */ React.createElement(Card, { key: r.id, scene: r, zoomIndex: 0, cardWidth: 280 })
    ));
  }
  function GenderGroup({ gender, label, runs }) {
    const M = useAppState((s) => s.M);
    const history = useAppState((s) => s.brackets.history);
    const active = useAppState((s) => !!s.brackets.active);
    const entrant = useEntrant("performer");
    const due = M ? championsRoundPool(M, history, gender) : { size: 0 };
    return /* @__PURE__ */ React.createElement("div", { className: "cherrypick-hof-group", "data-gender": gender }, /* @__PURE__ */ React.createElement("div", { className: "cherrypick-hof-head" }, /* @__PURE__ */ React.createElement("h5", null, label, " ", /* @__PURE__ */ React.createElement("span", { className: "badge badge-secondary" }, runs.length, " ", plural(runs.length, "bracket"))), due.size ? /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-secondary btn-sm cherrypick-champions-round",
        disabled: active,
        title: active ? "Finish or abandon the paused bracket first" : "",
        onClick: () => startChampionsRound(gender)
      },
      /* @__PURE__ */ React.createElement(Icon, { icon: faCrown2 }),
      /* @__PURE__ */ React.createElement("span", null, "Champions round (", due.size, ")")
    ) : /* @__PURE__ */ React.createElement("span", { className: "small text-muted" }, "Champions round at ", CHAMPIONS_MIN, " different champions")), /* @__PURE__ */ React.createElement(
      Cards,
      {
        kind: "performer",
        ids: distinct(runs.map((b) => b.result.champion))
      }
    ), /* @__PURE__ */ React.createElement("ul", { className: "list-unstyled small cherrypick-hof-list" }, runs.map((b) => {
      const semis = (b.result.semifinalists || []).map(
        (x) => entrant(x).name
      );
      return /* @__PURE__ */ React.createElement("li", { key: b.id }, /* @__PURE__ */ React.createElement("span", { className: "text-muted" }, day(b.finishedAt), ":"), " ", /* @__PURE__ */ React.createElement("b", null, entrant(b.result.champion).name), " ", /* @__PURE__ */ React.createElement("span", { className: "text-muted" }, b.champions ? "(Champions round) " : "", "beat", " ", entrant(b.result.finalist).name, " in the final", semis.length ? `; semifinalists ${names(semis)}` : "", " ·", " ", b.size), " ", /* @__PURE__ */ React.createElement(ChallengeMark, { b }));
    })));
  }
  function ClipGroup({ runs }) {
    const entrant = useEntrant("clip");
    return /* @__PURE__ */ React.createElement("div", { className: "cherrypick-hof-group", "data-kind": "clip" }, /* @__PURE__ */ React.createElement("div", { className: "cherrypick-hof-head" }, /* @__PURE__ */ React.createElement("h5", null, "Scenes", " ", /* @__PURE__ */ React.createElement("span", { className: "badge badge-secondary" }, runs.length, " ", plural(runs.length, "bracket")))), /* @__PURE__ */ React.createElement(Cards, { kind: "scene", ids: distinct(runs.map((b) => b.result.champion)) }), /* @__PURE__ */ React.createElement("ul", { className: "list-unstyled small cherrypick-hof-list" }, runs.map((b) => /* @__PURE__ */ React.createElement("li", { key: b.id }, /* @__PURE__ */ React.createElement("span", { className: "text-muted" }, day(b.finishedAt), ":"), " ", /* @__PURE__ */ React.createElement("b", null, entrant(b.result.champion).name), " ", /* @__PURE__ */ React.createElement("span", { className: "text-muted" }, "beat ", entrant(b.result.finalist).name, " in the final ·", " ", b.poolLabel, " · ", b.seeds.length), " ", /* @__PURE__ */ React.createElement(ChallengeMark, { b })))));
  }
  function AppliedBatches() {
    const applied = useAppState((s) => s.applied);
    if (!applied.length) return null;
    return /* @__PURE__ */ React.createElement("div", { className: "card setting-card cherrypick-applied-batches" }, applied.slice().reverse().map((a) => /* @__PURE__ */ React.createElement(
      SettingRow,
      {
        key: a.id,
        title: a.changes.length ? `Applied ${a.changes.length} ${a.kind === "performer" ? "performer " : ""}${plural(a.changes.length, "rating")}` : keptText(a),
        sub: [
          when(a.at) + (a.poolLabel ? ` · ${a.poolLabel}` : ""),
          a.changes.length ? keptText(a) : null
        ].filter(Boolean).join(" · ")
      },
      /* @__PURE__ */ React.createElement(AppliedButton, { a, className: "btn btn-secondary btn-sm" })
    )));
  }
  function HallOfFameSection() {
    const history = useAppState((s) => s.brackets.history);
    const active = useAppState((s) => s.brackets.active);
    const done = history.filter((b) => b.result?.champion).sort((a, b) => (b.finishedAt || "").localeCompare(a.finishedAt || ""));
    const perf = done.filter((b) => b.kind === "performer");
    const clips = done.filter((b) => b.kind === "clip");
    return /* @__PURE__ */ React.createElement(React.Fragment, null, perf.length ? /* @__PURE__ */ React.createElement("p", { className: "small" }, /* @__PURE__ */ React.createElement(Link6, { to: WINNERS_URL }, "Performers who have won a bracket"), " ", /* @__PURE__ */ React.createElement("span", { className: "text-muted" }, "(a Performers filter on the ", FIELDS2.titles, " custom field)")) : null, !done.length && !active ? /* @__PURE__ */ React.createElement("div", { className: "card setting-card" }, /* @__PURE__ */ React.createElement(
      SettingRow,
      {
        title: "No brackets yet",
        sub: "Start one with Bracket on the Performers page."
      }
    )) : null, GENDERS.map(([g, label]) => {
      const runs = perf.filter((b) => b.gender === g);
      return runs.length ? /* @__PURE__ */ React.createElement(GenderGroup, { key: g, gender: g, label, runs }) : null;
    }), clips.length ? /* @__PURE__ */ React.createElement(ClipGroup, { runs: clips }) : null, /* @__PURE__ */ React.createElement(AppliedBatches, null));
  }

  // src/js/features/brackets/index.jsx
  var OURS = new Set(Object.values(VIEWS));
  function registerBrackets() {
    registerDialog(VIEWS.setup, SetupSheet);
    registerDialog(VIEWS.clipSetup, ClipSetup);
    registerDialog(VIEWS.genders, GenderGrid);
    registerDialog(VIEWS.play, PlayDialog);
    registerDialog(VIEWS.challenge, ChallengeDialog);
    registerDialog(VIEWS.result, ResultDialog);
    registerDialog(VIEWS.apply, ApplyDialog);
    registerPageSection("hall-of-fame", 20, "Hall of Fame", HallOfFameSection);
    registerListOps();
    const STAYS = /* @__PURE__ */ new Set([VIEWS.result, VIEWS.challenge, VIEWS.apply]);
    store.subscribe((next, prev) => {
      const was = prev.dialog;
      if (was?.view !== VIEWS.result || next.dialog === was) return;
      if (next.dialog?.id === was.id && STAYS.has(next.dialog.view)) return;
      autoApplyBracket(was.id);
    });
    store.subscribe((next, prev) => {
      if (!next.watching || prev.watching || !OURS.has(next.dialog?.view)) return;
      if (next.dialog.view === VIEWS.play) pauseBracket();
      else store.set({ dialog: null });
    });
  }

  // src/js/features/watchThis.jsx
  var { useLayoutEffect, useMemo, useRef: useRef2, useState: useState3 } = React2;
  var { Link: Link7 } = ReactRouterDOM;
  var { loadableComponents: loadableComponents2 } = window.PluginApi;
  var PLAYER2 = [loadableComponents2.ScenePlayer];
  var ignore = () => {
  };
  function Box({ children }) {
    const ref = useRef2(null);
    useLayoutEffect(() => {
      const el = ref.current;
      let live = true;
      const fit2 = () => {
        if (!live) return;
        const above = el.getBoundingClientRect().top + window.scrollY;
        el.style.setProperty("--cherrypick-watch-above", `${Math.ceil(above)}px`);
        const line = el.querySelector(".cherrypick-watch-line");
        if (line)
          el.style.setProperty(
            "--cherrypick-watch-line",
            `${Math.ceil(line.getBoundingClientRect().height)}px`
          );
      };
      fit2();
      window.addEventListener("resize", fit2);
      document.fonts?.ready.then(fit2);
      return () => {
        live = false;
        window.removeEventListener("resize", fit2);
      };
    });
    return /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-watch", ref }, children);
  }
  function Skeleton() {
    return /* @__PURE__ */ React2.createElement(Box, null, /* @__PURE__ */ React2.createElement("div", { className: "skeleton-card cherrypick-watch-skeleton" }), /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-watch-line cherrypick-ui" }, /* @__PURE__ */ React2.createElement(BuildingLine, null)));
  }
  var basename = (path) => String(path || "").replace(/^.*[\\/]/, "");
  function Line({ scene, reason, canBack }) {
    const title = scene.title || basename(scene.files?.[0]?.path);
    return /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-watch-line cherrypick-ui" }, /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-watch-what" }, /* @__PURE__ */ React2.createElement(Link7, { className: "cherrypick-watch-title", to: `/scenes/${scene.id}` }, title), scene.performers.length ? /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-watch-performers" }, scene.performers.map((p, i) => /* @__PURE__ */ React2.createElement(React2.Fragment, { key: p.id }, i ? ", " : null, /* @__PURE__ */ React2.createElement(Link7, { to: `/performers/${p.id}` }, p.name)))) : null, reason ? /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-watch-reason text-muted" }, reason) : null), /* @__PURE__ */ React2.createElement("span", { className: "cherrypick-watch-buttons" }, canBack ? /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-secondary cherrypick-watch-back",
        onClick: back
      },
      "Back"
    ) : null, /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-secondary cherrypick-watch-skip",
        onClick: skip
      },
      "Skip"
    )));
  }
  function Pick({ item, canBack, watching }) {
    const loading2 = hooks.useLoadComponents(PLAYER2);
    const { data, previousData } = GQL.useFindSceneQuery({
      variables: { id: item.scene.id }
    });
    const scene = data?.findScene ?? previousData?.findScene;
    const { data: config } = GQL.useConfigurationQuery();
    const [hideScrubber] = useState3(
      () => !(config?.configuration?.interface?.showScrubber ?? true)
    );
    const reason = useMemo(() => item.reason(), [item]);
    const shown = useRef2(null);
    if (scene?.id === item.scene.id) shown.current = { scene, reason };
    const { ScenePlayer } = components;
    if (loading2 || !scene || !ScenePlayer) return /* @__PURE__ */ React2.createElement(Skeleton, null);
    return /* @__PURE__ */ React2.createElement(Box, null, /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-watch-player" }, /* @__PURE__ */ React2.createElement(
      ScenePlayer,
      {
        scene,
        hideScrubberOverride: hideScrubber,
        initialTimestamp: 0,
        sendSetTimestamp: ignore,
        onComplete: ignore,
        onNext: skip,
        onPrevious: canBack ? back : void 0
      }
    )), watching || !shown.current ? null : /* @__PURE__ */ React2.createElement(Line, { ...shown.current, canBack }));
  }
  function WatchThis() {
    const s = useAppState((x) => x);
    const v = watchSnapshot(s);
    if (!v) return /* @__PURE__ */ React2.createElement(Skeleton, null);
    const cur = visitState(s, v);
    const item = cur.current ? v.byId.get(cur.current) : null;
    if (!item) return null;
    return /* @__PURE__ */ React2.createElement(Pick, { item, canBack: cur.skips.length > 0, watching: s.watching });
  }

  // src/js/features/frontPage.jsx
  var snap2 = null;
  function snapshot(s) {
    if (!s.M) return null;
    const key = [s.visit, JSON.stringify(s.settings), s.M.db.hasStashdb].join("|");
    if (snap2?.key === key) return snap2;
    const sameVisit = snap2?.visit === s.visit;
    const skip2 = new Set(s.dontLearn.map((d) => d.sceneId));
    const signals = sameVisit ? snap2.signals : visitSignals(s.signals, skip2);
    const ctx = context(s.M, s);
    const small = tooSmall(s.db);
    let forYou = null;
    let fallback = null;
    let follow = [];
    if (s.settings.showForYou) {
      if (small) fallback = newInLibrary(ctx);
      else forYou = computeForYou(ctx, signals);
    }
    if (!small && s.settings.showFollowRows)
      follow = followRows(
        ctx,
        signals,
        forYou ? forYou.map((it) => it.scene.id) : []
      );
    snap2 = {
      key,
      visit: s.visit,
      signals,
      forYou,
      fallback,
      follow,
      next: shownSignals(
        signals,
        forYou ? forYou.map((it) => it.scene.id) : [],
        sameVisit ? s.signals.lastShownOpened : []
      ),
      stored: false
    };
    return snap2;
  }
  function SceneRow({ id, title, items, className, onOpen, extra }) {
    const hidden2 = useAppState((s) => s.notInterested);
    const recent = useAppState((s) => s.recentHidden);
    const isHidden = new Set(hidden2.map((n) => n.sceneId));
    const shown = (items || []).filter(
      (it) => !isHidden.has(it.scene.id) || recent.some((h) => h.sceneId === it.scene.id && h.rowId === id)
    );
    return /* @__PURE__ */ React.createElement(
      CardRow,
      {
        id,
        title,
        className: `cherrypick-ui ${className || ""}`,
        kind: "scene",
        extra,
        items: items ? shown : null,
        renderCard: (scene, it, i) => isHidden.has(it.scene.id) ? /* @__PURE__ */ React.createElement(
          HiddenCard,
          {
            key: "h" + scene.id,
            title: scene.title,
            onUndo: () => undoNotInterested(scene.id)
          }
        ) : /* @__PURE__ */ React.createElement(
          RowSceneCard,
          {
            key: scene.id,
            scene,
            item: it,
            rowId: id,
            index: i,
            onOpen
          }
        )
      }
    );
  }
  var { Link: Link8 } = ReactRouterDOM;
  function SharpenLine() {
    const M = useAppState((s) => s.M);
    const active = useAppState((s) => !!s.brackets.active);
    const rate = rateMore(M);
    if (!rate) return null;
    return /* @__PURE__ */ React.createElement("span", { className: "text-muted small cherrypick-sharpen" }, /* @__PURE__ */ React.createElement(Link8, { to: toRateUrl() }, rate), " or", " ", /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-link cherrypick-sharpen-bracket",
        onClick: () => active ? resumeBracket() : quickStartPerformers(null)
      },
      active ? "finish your bracket" : "play a bracket"
    ), " ", "to sharpen these picks");
  }
  function CherryPickRows() {
    const v = useAppState(snapshot);
    const watching = useAppState((x) => x.watching);
    const showForYou = useAppState((x) => x.settings.showForYou);
    useFallbackLookups(v?.fallback);
    if (v && !v.stored) {
      v.stored = true;
      setTimeout(() => store.set({ signals: v.next }), 0);
    }
    if (watching) return null;
    if (!v)
      return showForYou ? /* @__PURE__ */ React.createElement("div", { className: "recommendations-container cherrypick-front" }, /* @__PURE__ */ React.createElement(
        SceneRow,
        {
          id: "foryou",
          title: "For you",
          items: null,
          className: "cherrypick-for-you-building",
          extra: /* @__PURE__ */ React.createElement(BuildingLine, null)
        }
      )) : null;
    return /* @__PURE__ */ React.createElement("div", { className: "recommendations-container cherrypick-front" }, v.forYou ? /* @__PURE__ */ React.createElement(
      SceneRow,
      {
        id: "foryou",
        title: "For you",
        items: v.forYou,
        className: "cherrypick-for-you",
        onOpen: recordOpen,
        extra: /* @__PURE__ */ React.createElement(SharpenLine, null)
      }
    ) : null, v.fallback ? /* @__PURE__ */ React.createElement(
      SceneRow,
      {
        id: "fallback",
        title: "New in your library",
        items: v.fallback,
        className: "cherrypick-fallback"
      }
    ) : null, v.follow.map((r) => /* @__PURE__ */ React.createElement(
      SceneRow,
      {
        key: r.id,
        id: r.id,
        title: r.title,
        items: r.items,
        className: "cherrypick-follow"
      }
    )), /* @__PURE__ */ React.createElement(HallOfFameRow, { extra: /* @__PURE__ */ React.createElement(ResumePill, null) }));
  }
  var mirroredWatchThis = local.get(KEYS.mirror)?.watchThis === true;
  function FrontPiece() {
    const watchThis = useAppState(
      (s) => s.configLoaded ? s.settings.watchThis === true : mirroredWatchThis
    );
    return watchThis ? /* @__PURE__ */ React.createElement(Safe, { name: "Watch This" }, /* @__PURE__ */ React.createElement(WatchThis, null)) : /* @__PURE__ */ React.createElement(Safe, { name: "front page rows" }, /* @__PURE__ */ React.createElement(CherryPickRows, null));
  }
  var isRows = (el) => String(el?.props?.className || "").includes("recommendations-container");
  function registerFrontPage() {
    patchAfter(
      "FrontPage",
      (props, result) => isRows(result) ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(FrontPiece, null), result) : result
    );
  }

  // src/js/model/recs.js
  var tagSet = (s) => new Set(s.tags.filter((t) => !isPlaceholderTag(t)).map((t) => t.id));
  function jaccard(a, b) {
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    return inter / (a.size + b.size - inter || 1);
  }
  function performerTaste(M, p) {
    const st = M.stats.get("p:" + p.id);
    if (st && st.n >= 2)
      return `you average ${fmtStars(st.mean)}★ on ${pronoun(p)} scenes`;
    if (M.db.favoritePerformerIds.has(p.id)) return "a favorite of yours";
    return null;
  }
  var hiddenSets = /* @__PURE__ */ new WeakMap();
  var hidden = (state, id) => {
    const list = state.notInterested;
    let set2 = hiddenSets.get(list);
    if (!set2) hiddenSets.set(list, set2 = new Set(list.map((n) => n.sceneId)));
    return set2.has(id);
  };
  var keptOut = (ex, s) => ex.size && s.tags.some((t) => ex.has(t.id));
  function moreLikeThis(M, state, scene) {
    const db2 = M.db;
    const ex = excludedTagIds(db2, state.settings?.excludedTags);
    const tags = tagSet(scene);
    const perfIds = new Set(scene.performers.map((p) => p.id));
    const studioId = scene.studio?.id;
    const parentId = scene.studio?.parent?.id;
    const relate = (s) => {
      const shared = s.performers.filter((p) => perfIds.has(p.id));
      const sameStudio = studioId != null && s.studio?.id === studioId;
      const sameParent = !!parentId && (s.studio?.parent?.id === parentId || s.studio?.id === parentId);
      const jac = jaccard(tags, tagSet(s));
      const sim = 1 * shared.length + (sameStudio ? 0.6 : sameParent ? 0.25 : 0) + 1.5 * jac;
      return { shared, sameStudio, sameParent, jac, sim };
    };
    const inLib = [];
    for (const s of db2.owned) {
      if (s.id === scene.id || hidden(state, s.id) || keptOut(ex, s) || M.rating(s) != null || !barelyPlayed(s))
        continue;
      if (M.prediction(s.id).value < M.userMean - 0.6) continue;
      const r = relate(s);
      if (!r.shared.length && !r.sameStudio && !r.sameParent && r.jac < 0.25)
        continue;
      const score = M.prediction(s.id).value + 0.35 * r.sim;
      let reason, key;
      const best = r.shared.filter((p) => M.performerAffinity(p.id) > -0.05).sort((a, b) => M.performerAffinity(b.id) - M.performerAffinity(a.id))[0];
      if (best) {
        const taste = performerTaste(M, db2.performers.get(best.id) || best);
        reason = `Also stars ${best.name}` + (taste ? `; ${taste}` : "");
        key = "p:" + best.id;
      } else if (r.sameStudio || r.sameParent) {
        const st0 = r.sameStudio ? s.studio : { id: parentId, name: scene.studio.parent.name };
        const st = M.stats.get("s:" + st0.id);
        reason = `Also from ${st0.name}` + (st && st.n >= 2 ? `; you average ${fmtStars(st.mean)}★ there` : "");
        key = "s:" + st0.id;
      } else {
        const n = [...tags].filter((t) => tagSet(s).has(t)).length;
        reason = `Shares ${n} tags with this one`;
        key = null;
      }
      if (!s.local.play_count) reason += " · never played";
      else if (!behaviourOf(s)) reason += " · not watched yet";
      inLib.push({ scene: s, score, reason, key });
    }
    inLib.sort((a, b) => b.score - a.score);
    const outLib = [];
    for (const s of db2.scenes.values()) {
      if (s.owned || hidden(state, s.id) || keptOut(ex, s)) continue;
      const r = relate(s);
      if (!r.shared.length && !r.sameStudio && !r.sameParent) continue;
      const pop = popularity(db2, s, r.shared[0]?.id);
      const popRank = pop.performer?.rank ?? pop.studio?.rank ?? 12;
      const popBoost = 0.5 * (1 - (Math.min(popRank, 12) - 1) / 12) + (pop.global ? 0.25 : 0);
      const score = M.prediction(s.id).value + 0.3 * r.sim + popBoost;
      let reason, key;
      const best = r.shared.slice().sort((a, b) => M.performerAffinity(b.id) - M.performerAffinity(a.id))[0];
      if (best) {
        const bp = popularity(db2, s, best.id);
        const taste = performerTaste(M, db2.performers.get(best.id) || best);
        reason = bp.performer && bp.performer.performer.id === best.id ? `${best.name}'s #${bp.performer.rank} on StashDB` + (taste ? `; ${taste}` : "") : `Also stars ${best.name}` + (taste ? `; ${taste}` : "");
        key = "p:" + best.id;
      } else {
        const st = s.studio;
        reason = pop.studio && pop.studio.rank <= 10 ? `Among the 10 most popular at ${pop.studio.studio.name} on StashDB` : `Also from ${r.sameStudio ? st.name : st.parent?.name || st.name}`;
        key = "s:" + (r.sameStudio ? st.id : st.parent?.id || st.id);
      }
      outLib.push({ scene: s, score, reason, key });
    }
    outLib.sort((a, b) => b.score - a.score);
    return { inLibrary: inLib.slice(0, 8), notInLibrary: outLib.slice(0, 8) };
  }
  function theirScenesYouDontHave(M, state, performer) {
    const db2 = M.db;
    const ex = excludedTagIds(db2, state.settings?.excludedTags);
    let ids = performer.popularSceneIds;
    let ordered = true;
    if (!ids) {
      ordered = false;
      ids = performer.sceneIds.slice().sort(
        (a, b) => (db2.scenes.get(a).globalPopularityRank || 1e9) - (db2.scenes.get(b).globalPopularityRank || 1e9)
      );
    }
    return ids.map((id) => db2.scenes.get(id)).filter((s) => s && !s.owned && !hidden(state, s.id) && !keptOut(ex, s)).map((s) => {
      const pop = popularity(db2, s, performer.id);
      const of = performer.sceneCount ? `${performer.sceneCount.toLocaleString("en-US")} ` : "";
      const reason = ordered && pop.performer ? `#${pop.performer.rank} of ${pronoun(performer)} ${of}scenes on StashDB` + (pop.performer.top ? ` (top ${pop.performer.top}%)` : "") : pop.global ? `#${pop.global} most popular on StashDB` : `${performer.name} on StashDB`;
      return { scene: s, reason, key: "p:" + performer.id };
    });
  }

  // src/js/stashdb/connect.js
  var STASH_BOXES = `
  query CherryPickStashBoxes {
    configuration {
      general { stashBoxes { endpoint api_key name max_requests_per_minute } }
    }
  }
`;
  var VALIDATE = `
  query CherryPickValidateStashBox($input: StashBoxInput!) {
    validateStashBoxCredentials(input: $input) { valid status }
  }
`;
  var CONFIGURE_STASH_BOXES = `
  mutation CherryPickConfigureStashBoxes($input: ConfigGeneralInput!) {
    configureGeneral(input: $input) { stashBoxes { endpoint name } }
  }
`;
  async function validateKey(apiKey, endpoint = STASHDB_ENDPOINT) {
    const { validateStashBoxCredentials } = await run(VALIDATE, {
      input: { endpoint, api_key: apiKey.trim(), name: STASHBOX_NAME }
    });
    return validateStashBoxCredentials;
  }
  async function saveKey(apiKey) {
    const key = apiKey.trim();
    const { configuration } = await run(STASH_BOXES);
    const { boxes, endpoint } = withStashdbKey(
      configuration.general.stashBoxes || [],
      key
    );
    await runMutation(CONFIGURE_STASH_BOXES, { input: { stashBoxes: boxes } });
    utils.StashService.evictQueries(client().cache, [GQL.ConfigurationDocument]);
    allowLookups({ endpoint, apiKey: key });
  }
  function allowLookups(box) {
    store.set((s) => ({
      stashdb: box || s.stashdb,
      consent: {
        ...s.consent,
        stashdb: s.consent?.stashdb || (/* @__PURE__ */ new Date()).toISOString(),
        stashdbOff: null
      }
    }));
  }
  function stopLookups() {
    store.set((s) => ({
      consent: { ...s.consent, stashdbOff: (/* @__PURE__ */ new Date()).toISOString() }
    }));
  }

  // src/js/ui/ConnectLine.jsx
  function ConnectLine() {
    const hasKey = useAppState((s) => !!s.stashdb?.apiKey);
    return /* @__PURE__ */ React.createElement("div", { className: "cherrypick-connect-line cherrypick-ui" }, /* @__PURE__ */ React.createElement("span", { className: "text-muted" }, hasKey ? "StashDB lookups are off, so the scenes you're missing don't show." : "Connect StashDB to see what you're missing."), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-sm btn-primary",
        onClick: () => hasKey ? allowLookups() : openDialog({ view: "connect" })
      },
      hasKey ? "Use StashDB" : "Connect StashDB"
    ));
  }

  // src/js/features/scenePage.jsx
  var { OverlayTrigger, Popover, PopoverContent } = Bootstrap;
  function ScoreLine({ scene }) {
    const M = useAppState((s) => s.M);
    const db2 = useAppState((s) => s.db);
    const settings = useAppState((s) => s.settings);
    if (!settings.sceneLine || !M || !unratedByYou(M, scene)) return null;
    if (!M.gate)
      return M.ratingsToGo ? /* @__PURE__ */ React2.createElement(
        "span",
        {
          className: "text-muted small cherrypick-rate-more",
          title: `${NAME_S} guess at your rating shows here once it can check its guesses against your ratings.`
        },
        rateMore(M, { short: true }),
        " for Your score"
      ) : null;
    const p = M.prediction(scene.id);
    if (!p) return null;
    const label = badgeLabel(M, p.value, settings.relativeBadges);
    const r = M.reason(scene.id);
    const dbScene = db2?.scenes.get(scene.id);
    const pop = dbScene && db2.hasStashdb ? popularity(db2, dbScene) : null;
    const rank = pop ? performerRankPhrase(pop) : null;
    const popover = /* @__PURE__ */ React2.createElement(
      Popover,
      {
        id: `cherrypick-line-${scene.id}`,
        className: "cherrypick-line-popover"
      },
      /* @__PURE__ */ React2.createElement(PopoverContent, null, /* @__PURE__ */ React2.createElement("span", { className: "d-block" }, r?.text || "A lot like scenes you rate well", "."), pop?.held ? /* @__PURE__ */ React2.createElement("span", { className: "d-block text-muted small" }, pop.held, rank ? ` · ${rank}` : "") : null, /* @__PURE__ */ React2.createElement("span", { className: "d-block text-muted small" }, NAME_S, " guess (", fmtStars(p.value), "★). It never touches your rating."))
    );
    return /* @__PURE__ */ React2.createElement(
      OverlayTrigger,
      {
        trigger: ["hover", "focus", "click"],
        placement: "bottom",
        rootClose: true,
        overlay: popover
      },
      /* @__PURE__ */ React2.createElement(
        "button",
        {
          type: "button",
          className: "btn btn-link text-muted cherrypick-line-button"
        },
        label.line
      )
    );
  }
  function DontLearn({ scene }) {
    const on = useAppState((s) => isDontLearn(s, scene.id));
    return /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: `btn btn-link btn-sm cherrypick-line-button cherrypick-dont-learn ${on ? "text-warning" : "text-muted"}`,
        "aria-pressed": on,
        title: on ? `${PLUGIN_NAME} ignores this scene's plays, rating and picks. Click to learn from it again.` : `Keep this scene's plays, rating and picks out of ${NAME_S} picks`,
        onClick: () => toggleDontLearn(scene)
      },
      on ? "Not learning from this · undo" : "Don't learn from this"
    );
  }
  function ToolbarExtras({ scene }) {
    const anchor = React2.useRef(null);
    const [slot, setSlot] = React2.useState(null);
    React2.useLayoutEffect(() => {
      const group2 = anchor.current?.closest(".row")?.querySelector(".scene-toolbar .scene-toolbar-group");
      if (!group2) return;
      const el = document.createElement("span");
      el.className = "cherrypick-score-line cherrypick-ui";
      group2.appendChild(el);
      setSlot(el);
      return () => {
        el.remove();
        setSlot(null);
      };
    }, [scene?.id]);
    return /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement("span", { ref: anchor, hidden: true }), slot ? ReactDOM.createPortal(
      /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(ScoreLine, { scene }), /* @__PURE__ */ React2.createElement(DontLearn, { scene })),
      slot
    ) : null);
  }
  function MoreLikeThis({ scene }) {
    const s = useAppState((x) => x);
    const lookups = useSceneLookups(scene);
    const dbScene = s.M ? s.db.scenes.get(scene.id) : null;
    const shown = !!s.settings.showMoreLikeThis;
    const r = React2.useMemo(
      () => shown && dbScene ? moreLikeThis(s.M, s, dbScene) : null,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [shown, s.M, dbScene, s.settings.excludedTags, s.notInterested]
    );
    if (!s.settings.showMoreLikeThis || !s.M || s.watching) return null;
    if (!dbScene) return null;
    const rowId = "mlt-" + scene.id;
    const card = (id) => (rec, it, i) => /* @__PURE__ */ React2.createElement(RowSceneCard, { key: rec.id, scene: rec, item: it, rowId: id, index: i });
    const missing = s.settings.outOfLibrary;
    const ready = stashdbReady(s);
    const missingId = rowId + "-missing";
    return /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-more-like-this recommendations-container cherrypick-ui" }, /* @__PURE__ */ React2.createElement("div", { className: "recommendation-row-head cherrypick-mlt-head" }, /* @__PURE__ */ React2.createElement("div", null, /* @__PURE__ */ React2.createElement("h2", null, "More like this"))), /* @__PURE__ */ React2.createElement(
      CardRow,
      {
        id: rowId,
        title: "In your library",
        kind: "scene",
        className: "cherrypick-mlt-owned",
        items: r.inLibrary,
        empty: "Nothing like this one that you haven't watched yet.",
        renderCard: card(rowId)
      }
    ), missing && ready && lookups !== "failed" ? /* @__PURE__ */ React2.createElement(
      CardRow,
      {
        id: missingId,
        title: "Not in your library",
        kind: "stashdb-scene",
        className: "cherrypick-mlt-missing",
        items: lookups === "idle" || lookups === "loading" ? null : r.notInLibrary,
        empty: "StashDB has nothing like this one that you don't have.",
        renderCard: (rec, it) => /* @__PURE__ */ React2.createElement(
          StashdbSceneCard,
          {
            key: rec.id,
            scene: rec,
            item: it,
            rowId: missingId
          }
        )
      }
    ) : null, missing && !ready ? /* @__PURE__ */ React2.createElement(ConnectLine, null) : null);
  }
  function registerScenePage() {
    patchAfter("ScenePage", (props, result) => /* @__PURE__ */ React2.createElement(React2.Fragment, null, result, /* @__PURE__ */ React2.createElement(Safe, { name: "scene toolbar" }, /* @__PURE__ */ React2.createElement(ToolbarExtras, { scene: props.scene })), /* @__PURE__ */ React2.createElement(Safe, { name: "More like this" }, /* @__PURE__ */ React2.createElement(MoreLikeThis, { scene: props.scene }))));
  }

  // src/js/features/navbar.jsx
  function NavIcon() {
    const { NavLink } = ReactRouterDOM;
    return /* @__PURE__ */ React.createElement(
      NavLink,
      {
        className: "nav-utility cherrypick-ui cherrypick-nav-icon",
        exact: true,
        to: PLUGIN_ROUTE
      },
      /* @__PURE__ */ React.createElement(
        "button",
        {
          type: "button",
          className: "btn minimal d-flex align-items-center h-100",
          title: PLUGIN_NAME
        },
        /* @__PURE__ */ React.createElement(Cherries, null)
      )
    );
  }
  function registerNavbar() {
    patchAfter("MainNavBar.UtilityItems", (props, result) => /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Safe, { name: "navbar icon" }, /* @__PURE__ */ React.createElement(NavIcon, null)), result, /* @__PURE__ */ React.createElement(Safe, { name: "dialogs" }, /* @__PURE__ */ React.createElement(DialogHost, null))));
  }

  // src/js/features/performerLine.js
  var MOVING = 0.05;
  var theirOf = (gender) => pronoun({ local: { gender: gender ?? null } });
  function performerLineParts({ stats, honours, offset = 0, gender }) {
    const their = theirOf(gender);
    const parts = [];
    if (stats?.n >= 2 && stats.mean != null)
      parts.push(`You average ${fmtStars(stats.mean)}★ on ${their} scenes`);
    else if (stats?.n === 1 && stats.mean != null)
      parts.push(`You rated one of ${their} scenes ${fmtStars(stats.mean)}★`);
    else if (stats?.watched)
      parts.push(`You've watched ${stats.watched} of ${their} scenes`);
    if (honours?.champion)
      parts.push(
        honours.champion > 1 ? `${honours.champion}× champion` : "Bracket champion"
      );
    else if (honours?.finalist)
      parts.push(
        honours.finalist > 1 ? `${honours.finalist}× finalist` : "Bracket finalist"
      );
    if (honours?.challenger) parts.push("beat your favorites");
    if (Math.abs(offset) >= MOVING)
      parts.push(
        offset > 0 ? "rising in your brackets" : "slipping in your brackets"
      );
    return parts;
  }
  function performerLine(input) {
    const text = performerLineParts(input).join(" · ");
    return text ? text[0].toUpperCase() + text.slice(1) : null;
  }
  var honoursCache = /* @__PURE__ */ new WeakMap();
  function honoursOf(history) {
    if (!honoursCache.has(history))
      honoursCache.set(history, performerHonours(history));
    return honoursCache.get(history);
  }
  function performerLineFor(M, history, performer) {
    return performerLine({
      stats: M ? M.performerSceneStats(performer.id) : null,
      honours: honoursOf(history)[performer.id] || null,
      offset: M?.bt.bracketPerformerOffset.get(performer.id) || 0,
      gender: performer.gender
    });
  }
  function honoursMark(honours) {
    if (honours?.challenger)
      return {
        kind: "challenger",
        count: honours.champion > 1 ? honours.champion : null,
        title: honours.champion > 1 ? `Bracket champion ×${honours.champion} who beat your favorites` : "Bracket champion who beat your favorites"
      };
    if (honours?.champion)
      return {
        kind: "champion",
        count: honours.champion > 1 ? honours.champion : null,
        title: honours.champion > 1 ? `Bracket champion ×${honours.champion}` : "Bracket champion"
      };
    if (honours?.finalist)
      return {
        kind: "finalist",
        count: null,
        title: honours.finalist > 1 ? `Bracket finalist ×${honours.finalist}` : "Bracket finalist"
      };
    return null;
  }

  // src/js/features/performers.jsx
  function ForYouLine({ performer, fullWidth }) {
    const show = useAppState((s) => s.settings.performerLine);
    const watching = useAppState((s) => s.watching);
    const M = useAppState((s) => s.M);
    const history = useAppState((s) => s.brackets.history);
    if (!show || watching) return null;
    const text = performerLineFor(M, history, performer);
    if (!text) return null;
    return /* @__PURE__ */ React2.createElement("div", { className: "detail-item cherrypick-performer-line cherrypick-ui" }, /* @__PURE__ */ React2.createElement("span", { className: "detail-item-title cherrypick-performer-line" }, "For you ", /* @__PURE__ */ React2.createElement(Cherries, null), fullWidth ? ":" : ""), /* @__PURE__ */ React2.createElement("span", { className: "detail-item-value cherrypick-performer-line" }, text));
  }
  function Honours({ performer }) {
    const show = useAppState((s) => s.settings.medals);
    const history = useAppState((s) => s.brackets.history);
    if (!show) return null;
    const mark = honoursMark(honoursOf(history)[performer.id]);
    if (!mark) return null;
    const { Icon: Icon3 } = components;
    const { faCrown: faCrown3, faMedal, faTrophy: faTrophy3 } = FontAwesomeSolid;
    const icon = { challenger: faTrophy3 || faCrown3, champion: faCrown3 }[mark.kind];
    return /* @__PURE__ */ React2.createElement(
      "div",
      {
        className: `cherrypick-honours cherrypick-ui ${icon ? "text-warning" : "text-light"} ${mark.kind}`,
        title: mark.title
      },
      /* @__PURE__ */ React2.createElement(Icon3, { icon: icon || faMedal }),
      mark.count ? /* @__PURE__ */ React2.createElement("small", null, mark.count) : null
    );
  }
  function registerPerformers() {
    patchAfter("PerformerDetailsPanel.DetailGroup", (props, result) => {
      if (!props.performer) return result;
      const line = /* @__PURE__ */ React2.createElement(Safe, { key: "cherrypick-performer-line", name: "For you line" }, /* @__PURE__ */ React2.createElement(ForYouLine, { performer: props.performer, fullWidth: props.fullWidth }));
      if (React2.isValidElement(result) && result.type === "div")
        return React2.cloneElement(
          result,
          void 0,
          ...React2.Children.toArray(result.props.children),
          line
        );
      return /* @__PURE__ */ React2.createElement(React2.Fragment, null, result, line);
    });
    patchAfter("PerformerCard.Overlays", (props, result) => /* @__PURE__ */ React2.createElement(React2.Fragment, null, result, /* @__PURE__ */ React2.createElement(Safe, { name: "crowns and medals" }, /* @__PURE__ */ React2.createElement(Honours, { performer: props.performer }))));
  }

  // src/js/features/settingsExtras.jsx
  var { Button: Button2 } = Bootstrap;
  var forgetBracketGender2 = () => store.set((s) => ({
    bracketPrefs: { ...s.bracketPrefs || {}, gender: null }
  }));
  function BracketGender() {
    const gender = useAppState((s) => s.bracketPrefs?.gender ?? null);
    const [forgot, setForgot] = React2.useState(false);
    const { Setting } = components;
    const id = `plugin-${PLUGIN_ID}-bracket-gender`;
    if (gender)
      return /* @__PURE__ */ React2.createElement(
        Setting,
        {
          id,
          className: "cherrypick-ui",
          heading: `Bracket gender: ${genderLabel(gender) || gender}`,
          subHeading: "Remembered from your last bracket. Forget it and brackets start from your largest pool."
        },
        /* @__PURE__ */ React2.createElement(
          Button2,
          {
            variant: "secondary",
            size: "sm",
            onClick: () => {
              setForgot(true);
              forgetBracketGender2();
            }
          },
          "Forget"
        )
      );
    if (!forgot) return null;
    return /* @__PURE__ */ React2.createElement(
      Setting,
      {
        id,
        className: "cherrypick-ui",
        heading: "Bracket gender: forgotten",
        subHeading: /* @__PURE__ */ React2.createElement(React2.Fragment, null, "Brackets start from your largest pool.", " ", /* @__PURE__ */ React2.createElement("span", { className: "d-block text-warning" }, "Saved when you leave Settings: Stash's Settings page would overwrite it now."))
      }
    );
  }
  function CuratorOffer2() {
    const { plugins, savePluginSettings } = hooks.useSettings();
    const map = plugins?.[PLUGIN_ID] || {};
    const show = useCuratorOffer(map.badges ?? SETTING_DEFAULTS.badges);
    const { Setting } = components;
    if (!show) return null;
    const answer = (a) => {
      savePluginSettings(PLUGIN_ID, withCuratorAnswer(map, a, answerSettings(a)));
      answerCuratorOffer(a, { stashSaves: true });
    };
    return /* @__PURE__ */ React2.createElement(
      Setting,
      {
        id: `plugin-${PLUGIN_ID}-curator-offer`,
        className: "cherrypick-ui cherrypick-curator-offer",
        heading: OFFER.title,
        subHeading: OFFER.sub
      },
      /* @__PURE__ */ React2.createElement(
        Button2,
        {
          variant: "secondary",
          size: "sm",
          className: "cherrypick-curator-hide",
          onClick: () => answer("hide")
        },
        OFFER.hide
      ),
      " ",
      /* @__PURE__ */ React2.createElement(
        Button2,
        {
          variant: "secondary",
          size: "sm",
          className: "cherrypick-curator-keep",
          onClick: () => answer("keep")
        },
        OFFER.keep
      )
    );
  }
  function PageLink() {
    const { Setting } = components;
    const { Link: Link10 } = ReactRouterDOM;
    return /* @__PURE__ */ React2.createElement(
      Setting,
      {
        id: `plugin-${PLUGIN_ID}-page`,
        className: "cherrypick-ui",
        heading: `${PLUGIN_NAME} page`,
        subHeading: `How well Your score is doing, the full Hall of Fame, StashDB, what you hid, and Remove ${PLUGIN_NAME} data.`
      },
      /* @__PURE__ */ React2.createElement(Link10, { className: "btn btn-secondary btn-sm", to: PLUGIN_ROUTE }, "Open")
    );
  }
  function registerSettingsExtras() {
    patch.before(
      "PluginSettings",
      (props, ...rest) => props?.pluginID === PLUGIN_ID && Array.isArray(props.settings) ? [{ ...props, settings: inManifestOrder(props.settings) }, ...rest] : [props, ...rest]
    );
    patchAfter("PluginSettings", (props, result) => {
      if (props.pluginID !== PLUGIN_ID) return result;
      const rows = /* @__PURE__ */ React2.createElement(Safe, { key: "cherrypick-settings-extras", name: "settings extras" }, /* @__PURE__ */ React2.createElement(Safe, { name: "Curator offer" }, /* @__PURE__ */ React2.createElement(CuratorOffer2, null)), /* @__PURE__ */ React2.createElement(BracketGender, null), /* @__PURE__ */ React2.createElement(PageLink, null));
      if (React2.isValidElement(result) && result.type === "div")
        return React2.cloneElement(
          result,
          void 0,
          ...React2.Children.toArray(result.props.children),
          rows
        );
      return /* @__PURE__ */ React2.createElement(React2.Fragment, null, result, /* @__PURE__ */ React2.createElement("div", { className: "plugin-settings" }, rows));
    });
  }

  // src/js/features/stashdb.jsx
  var { Button: Button3, Modal: Modal2 } = Bootstrap;
  var { Link: Link9 } = ReactRouterDOM;
  var { faCheck: faCheck4, faExternalLinkAlt: faExternalLinkAlt2 } = FontAwesomeSolid;
  var GUIDELINES = "https://guidelines.stashdb.org/docs/faq_getting-started/stashdb/accessing-stashdb/";
  var REGISTER = "https://stashdb.org/register";
  var EXTERNAL2 = { target: "_blank", rel: "noopener noreferrer" };
  function Icon2({ icon, className }) {
    const { Icon: StashIcon } = components;
    return StashIcon ? /* @__PURE__ */ React2.createElement(StashIcon, { icon, className }) : null;
  }
  var STEPS = ["Get a key", "Paste it", "Done"];
  function Steps({ step }) {
    return /* @__PURE__ */ React2.createElement("ol", { className: "cherrypick-steps" }, STEPS.map((t, i) => /* @__PURE__ */ React2.createElement(
      "li",
      {
        key: t,
        className: step === i + 1 ? "active border-primary" : step > i + 1 ? "done" : ""
      },
      t
    )));
  }
  function ConnectDialog() {
    const [step, setStep] = React2.useState(1);
    const [key, setKey] = React2.useState("");
    const [busy, setBusy] = React2.useState(false);
    const [problem, setProblem] = React2.useState(null);
    const attempt = async (fn) => {
      setBusy(true);
      setProblem(null);
      try {
        await fn();
      } catch (e) {
        setProblem(`Stash could not check the key: ${e?.message || e}`);
      }
      setBusy(false);
    };
    const validate = () => attempt(async () => {
      const r = await validateKey(key, STASHDB_ENDPOINT);
      if (!r.valid) {
        setProblem(r.status);
        return;
      }
      await saveKey(key);
      setStep(3);
    });
    let body, footer;
    if (step === 1) {
      body = /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement("p", null, "StashDB is the community database behind Stash's scene matching. With a free account, ", PLUGIN_NAME, " can show how widely a scene is held and find the ones you don't have."), /* @__PURE__ */ React2.createElement("p", { className: "text-muted small" }, "Registration needs an invite key, which StashDB's guidelines page publishes."), /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-connect-buttons" }, /* @__PURE__ */ React2.createElement("a", { className: "btn btn-secondary", href: GUIDELINES, ...EXTERNAL2 }, "StashDB guidelines (invite key) ", /* @__PURE__ */ React2.createElement(Icon2, { icon: faExternalLinkAlt2 })), /* @__PURE__ */ React2.createElement("a", { className: "btn btn-secondary", href: REGISTER, ...EXTERNAL2 }, "Register on StashDB ", /* @__PURE__ */ React2.createElement(Icon2, { icon: faExternalLinkAlt2 }))));
      footer = /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(Button3, { variant: "secondary", onClick: closeDialog }, "Later"), /* @__PURE__ */ React2.createElement(Button3, { variant: "primary", onClick: () => setStep(2) }, "I have a key"));
    } else if (step === 2) {
      body = /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement("p", null, "On StashDB, open your profile and copy your API key. Paste it here."), /* @__PURE__ */ React2.createElement(
        "input",
        {
          className: "form-control text-monospace cherrypick-key-input",
          placeholder: "eyJhbGciOi…",
          "aria-label": "StashDB API key",
          autoComplete: "off",
          spellCheck: false,
          value: key,
          onChange: (e) => setKey(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter" && key.trim() && !busy) validate();
          }
        }
      ), problem ? /* @__PURE__ */ React2.createElement("p", { className: "text-danger mt-2 cherrypick-key-problem" }, problem) : null, /* @__PURE__ */ React2.createElement("p", { className: "small text-muted mt-2" }, "The key goes into Stash's own settings, like any stash-box."));
      footer = /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(
        Button3,
        {
          variant: "secondary",
          onClick: () => {
            setProblem(null);
            setStep(1);
          }
        },
        "Back"
      ), /* @__PURE__ */ React2.createElement(
        Button3,
        {
          variant: "primary",
          disabled: !key.trim() || busy,
          onClick: validate
        },
        busy ? "Validating…" : "Validate"
      ));
    } else {
      body = /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-connected" }, /* @__PURE__ */ React2.createElement(Icon2, { icon: faCheck4, className: "text-success" }), /* @__PURE__ */ React2.createElement("div", null, /* @__PURE__ */ React2.createElement("b", null, "Added StashDB to your Stash settings."), /* @__PURE__ */ React2.createElement("div", { className: "small text-muted" }, "You'll find it in Settings › Metadata Providers. Stash's Tagger can use it too.")));
      footer = /* @__PURE__ */ React2.createElement(Button3, { variant: "primary", onClick: closeDialog }, "Done");
    }
    return /* @__PURE__ */ React2.createElement(
      Modal2,
      {
        show: true,
        onHide: closeDialog,
        className: "cherrypick-ui cherrypick-connect"
      },
      /* @__PURE__ */ React2.createElement(Modal2.Header, { closeButton: true }, /* @__PURE__ */ React2.createElement(Modal2.Title, null, "Connect StashDB")),
      /* @__PURE__ */ React2.createElement(Modal2.Body, null, /* @__PURE__ */ React2.createElement(Steps, { step }), body),
      /* @__PURE__ */ React2.createElement(Modal2.Footer, null, footer)
    );
  }
  function age(ms) {
    const days = Math.floor((Date.now() - ms) / 864e5);
    return days < 1 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  }
  function StashdbSection() {
    const stashdb = useAppState((s) => s.stashdb);
    const off = useAppState((s) => s.consent?.stashdbOff);
    const lookups = useAppState((s) => s.stashdbLookups);
    const [stats, setStats] = React2.useState(null);
    const [clearing, setClearing] = React2.useState(false);
    React2.useEffect(() => {
      let live = true;
      cacheStats().then((x) => live && setStats(x));
      return () => {
        live = false;
      };
    }, [lookups]);
    const ready = !!(stashdb?.apiKey && !off);
    const count2 = stats?.count || 0;
    let status;
    if (ready)
      status = /* @__PURE__ */ React2.createElement(
        SettingRow,
        {
          title: "Connected",
          sub: `Using the StashDB key in Settings › Metadata Providers, for popularity and the scenes you don't have. ${PLUGIN_NAME} sends StashDB the ids of the performers and scenes on the pages you open, with that key.`
        },
        /* @__PURE__ */ React2.createElement(
          Link9,
          {
            className: "btn btn-secondary btn-sm",
            to: "/settings?tab=metadata-providers"
          },
          "Manage"
        ),
        " ",
        /* @__PURE__ */ React2.createElement(
          Button3,
          {
            variant: "secondary",
            size: "sm",
            className: "cherrypick-stashdb-off",
            onClick: stopLookups
          },
          "Stop using StashDB"
        )
      );
    else if (stashdb?.apiKey)
      status = /* @__PURE__ */ React2.createElement(
        SettingRow,
        {
          title: "Off",
          sub: `Stash has a StashDB key, and ${PLUGIN_NAME} leaves it alone until you turn StashDB back on.`
        },
        /* @__PURE__ */ React2.createElement(
          Button3,
          {
            variant: "primary",
            size: "sm",
            className: "cherrypick-stashdb-on",
            onClick: () => allowLookups()
          },
          "Use StashDB"
        )
      );
    else
      status = /* @__PURE__ */ React2.createElement(
        SettingRow,
        {
          title: "Not connected",
          sub: "Your score and brackets work without it. A free StashDB account adds popularity and the scenes you're missing."
        },
        /* @__PURE__ */ React2.createElement(
          Button3,
          {
            variant: "primary",
            size: "sm",
            onClick: () => openDialog({ view: "connect" })
          },
          "Connect StashDB"
        )
      );
    return /* @__PURE__ */ React2.createElement("div", { className: "card setting-card" }, status, ready || count2 ? /* @__PURE__ */ React2.createElement(
      SettingRow,
      {
        title: "Cache",
        sub: `${count2 ? `${count2} lookup${count2 === 1 ? "" : "s"}, the oldest from ${age(stats.oldest)}.` : "Nothing looked up yet."} Lookups are kept in this browser for 30 days, and asked for again in the background after 7.`
      },
      /* @__PURE__ */ React2.createElement(
        Button3,
        {
          variant: "secondary",
          size: "sm",
          className: "cherrypick-clear-stashdb",
          disabled: !count2 || clearing,
          onClick: async () => {
            setClearing(true);
            await clearStashdbCache();
            setStats(await cacheStats());
            setClearing(false);
          }
        },
        clearing ? "Clearing…" : "Clear StashDB cache"
      )
    ) : null);
  }
  var ZOOM_WIDTHS = [280, 340, 480, 640];
  var isPhone = () => window.matchMedia("only screen and (max-width: 576px)").matches;
  function cardWidth(container, zoom) {
    if (isPhone()) return void 0;
    const preferred = ZOOM_WIDTHS[zoom] ?? ZOOM_WIDTHS[1];
    if (!container) return preferred;
    const usable = container - 30;
    return usable / Math.ceil(usable / preferred) - 10;
  }
  function useGrid() {
    const [el, setEl] = React2.useState(null);
    const [size, setSize] = React2.useState({ width: 0, zoom: 1 });
    React2.useEffect(() => {
      if (!el) return;
      const measure = () => {
        const card = el.closest(".tab-pane, .tab-content")?.querySelector(".scene-card:not(.cherrypick-missing)");
        const zoom = Number(/\bzoom-(\d)\b/.exec(card?.className || "")?.[1] ?? 1);
        const width = el.getBoundingClientRect().width;
        setSize(
          (s) => Math.abs(s.width - width) > 20 || s.zoom !== zoom ? { width, zoom } : s
        );
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, [el]);
    return [setEl, size];
  }
  var SHOWN2 = 12;
  function useTheirScenes(s, rec, enabled) {
    const { M } = s;
    return React2.useMemo(
      () => enabled && rec ? theirScenesYouDontHave(M, s, rec).slice(0, SHOWN2) : [],
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [enabled, M, rec, s.settings.excludedTags, s.notInterested]
    );
  }
  function NotInYourLibrary({ performer }) {
    const stashId = stashdbIdOf(performer.stash_ids);
    const on = useAppState((s2) => s2.settings.outOfLibrary);
    usePerformerLookups(stashId, on);
    const s = useAppState((x) => x);
    const [gridRef, grid] = useGrid();
    const ready = stashdbReady(s);
    const state = stashId && ready ? lookupState(s, performerKey(stashId)) : "idle";
    const rec = s.M ? s.db.performers.get(performer.id) : null;
    const loading2 = state === "idle" || state === "loading" || !s.M;
    const items = useTheirScenes(
      s,
      rec,
      !!stashId && on && ready && !loading2 && state !== "failed"
    );
    if (!stashId || !on || s.watching) return null;
    if (state === "failed") return null;
    if (s.M && !rec) return null;
    if (ready && !loading2 && !items.length) return null;
    const rowId = "missing-" + performer.id;
    const width = cardWidth(grid.width, grid.zoom);
    return /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-not-in-library cherrypick-ui" }, /* @__PURE__ */ React2.createElement("h5", { className: "cherrypick-section-title" }, "Not in your library"), !ready ? /* @__PURE__ */ React2.createElement(ConnectLine, null) : loading2 ? /* @__PURE__ */ React2.createElement("div", { className: "cherrypick-row-empty text-muted" }, "Looking ", performer.name, " up on StashDB…") : /* @__PURE__ */ React2.createElement("div", { className: "row justify-content-center", ref: gridRef }, items.map((it) => /* @__PURE__ */ React2.createElement(
      StashdbSceneCard,
      {
        key: it.scene.id,
        scene: it.scene,
        item: it,
        rowId,
        width,
        zoom: grid.zoom
      }
    ))));
  }
  function registerStashdb() {
    registerDialog("connect", ConnectDialog);
    registerPageSection("stashdb", 30, "StashDB", StashdbSection);
    patchAfter("PerformerScenesPanel", (props, result) => /* @__PURE__ */ React2.createElement(React2.Fragment, null, result, /* @__PURE__ */ React2.createElement(Safe, { name: "Not in your library" }, /* @__PURE__ */ React2.createElement(NotInYourLibrary, { performer: props.performer }))));
  }

  // src/js/main.jsx
  registerRowCards();
  registerScoreBadge();
  registerFrontPage();
  registerScenePage();
  registerNavbar();
  registerPluginPage();
  registerPerformers();
  registerSettingsExtras();
  registerBrackets();
  registerStashdb();
  keepModelCurrent();
  watchPlayback();
  boot();
})();
