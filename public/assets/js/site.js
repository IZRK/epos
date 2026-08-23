const menuButton = document.querySelector("[data-menu-toggle]");
const menuLabel = document.querySelector("[data-menu-label]");
const navigation = document.querySelector("[data-site-nav]");
const submenuButtons = [...document.querySelectorAll("[data-submenu-toggle]")];
const mobileJumpMenus = [...document.querySelectorAll("[data-mobile-jump-menu]")];
const desktopQuery = window.matchMedia("(min-width: 73.751rem)");

function setMenu(open) {
  if (!menuButton || !navigation) return;
  menuButton.setAttribute("aria-expanded", String(open));
  navigation.classList.toggle("is-open", open);
  navigation.toggleAttribute("inert", !desktopQuery.matches && !open);
  document.body.classList.toggle("menu-open", open && !desktopQuery.matches);
  if (menuLabel) menuLabel.textContent = open ? "Close" : "Menu";
}

function setSubmenu(button, open) {
  button.setAttribute("aria-expanded", String(open));
  button.closest(".has-submenu")?.classList.toggle("is-open", open);
}

menuButton?.addEventListener("click", () => {
  setMenu(menuButton.getAttribute("aria-expanded") !== "true");
});

submenuButtons.forEach((button) => {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = button.getAttribute("aria-expanded") !== "true";
    submenuButtons.forEach((other) => {
      if (other !== button) setSubmenu(other, false);
    });
    setSubmenu(button, willOpen);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const menuWasOpen = menuButton?.getAttribute("aria-expanded") === "true";
  setMenu(false);
  submenuButtons.forEach((button) => setSubmenu(button, false));
  if (menuWasOpen) menuButton?.focus();
});

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-site-header]")) return;
  submenuButtons.forEach((button) => setSubmenu(button, false));
  if (!desktopQuery.matches) setMenu(false);
});

navigation?.addEventListener("click", (event) => {
  if (!desktopQuery.matches && event.target.closest("a")) setMenu(false);
});

mobileJumpMenus.forEach((menu) => {
  menu.addEventListener("click", (event) => {
    if (event.target.closest("a")) menu.removeAttribute("open");
  });
});

desktopQuery.addEventListener("change", () => {
  setMenu(false);
  submenuButtons.forEach((button) => setSubmenu(button, false));
});

setMenu(false);
