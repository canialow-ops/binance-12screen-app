(function (global) {
  function isHttps() {
    return String(global.location.protocol).toLowerCase() === "https:";
  }

  function httpBase() {
    return (isHttps() ? "https://" : "http://") + global.location.host;
  }

  function wsUrl(pathname) {
    const raw = pathname == null || pathname === "" ? "/ws" : String(pathname);
    const path = raw.charAt(0) === "/" ? raw : "/" + raw;
    return (isHttps() ? "wss://" : "ws://") + global.location.host + path;
  }

  function apiUrl(path) {
    const raw = String(path || "/");
    const p = raw.charAt(0) === "/" ? raw : "/" + raw;
    return httpBase() + p;
  }

  function pageUrl(file) {
    return String(file || "").replace(/^\//, "");
  }

  global.NEEKO_ORIGIN = { isHttps: isHttps, httpBase: httpBase, wsUrl: wsUrl, apiUrl: apiUrl, pageUrl: pageUrl };
})(window);
