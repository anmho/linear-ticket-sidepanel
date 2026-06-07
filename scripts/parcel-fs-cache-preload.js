const Module = require("node:module");
const path = require("node:path");

// Used only when build.js detects that Parcel's native LMDB cache cannot open.
const appRoot = process.env.PARCEL_FS_CACHE_APP_ROOT || process.cwd();
const appRequire = Module.createRequire(path.join(appRoot, "package.json"));
const originalLoad = Module._load;

Module._load = function loadWithParcelFsCache(request, parent, isMain) {
  const loaded = originalLoad.apply(this, arguments);

  if (request === "@parcel/cache" && loaded?.FSCache && loaded?.LMDBCache) {
    const { NodeFS } = appRequire("@parcel/fs");

    function ParcelFsCacheFallback(cacheDir) {
      return new loaded.FSCache(new NodeFS(), cacheDir);
    }

    ParcelFsCacheFallback.prototype = loaded.FSCache.prototype;

    return {
      ...loaded,
      LMDBCache: ParcelFsCacheFallback,
    };
  }

  return loaded;
};
