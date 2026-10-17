/* Visitor Tracking bootstrap. Classic script so window.init_tracer exists
   before https://app.visitortracking.com/assets/js/tracer.js runs. */
(function () {
  window.init_tracer = function init_tracer() {
    try {
      window.__drophunterTracer = new Tracer({
        websiteId: "be25aee3-1348-469a-a992-3d793e4bc888",
        async: true,
        debug: false,
      });
    } catch {
      /* tracer.js blocked or Tracer missing */
    }
  };

  document.addEventListener(
    "click",
    function (event) {
      var el = event.target && event.target.closest && event.target.closest("[data-track]");
      if (!el) return;
      var tracer = window.__drophunterTracer;
      if (tracer && typeof tracer.addEventTrace === "function") {
        tracer.addEventTrace(event);
      }
    },
    true,
  );
})();
