// Apply theme immediately on load
const savedTheme = localStorage.getItem("anonhub-theme") || "modern";
document.documentElement.setAttribute("data-theme", savedTheme);

document.querySelectorAll(".theme-switcher button").forEach(btn => {
    btn.addEventListener("click", () => {
        const theme = btn.getAttribute("data-theme");
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem("anonhub-theme", theme);
    });
});
