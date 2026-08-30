(function () {
  "use strict";
  const buttons = document.querySelectorAll(".tabbar .tab");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tabpanel").forEach((p) => (p.hidden = true));
      document.getElementById("panel-" + btn.dataset.tab).hidden = false;
    });
  });
})();
