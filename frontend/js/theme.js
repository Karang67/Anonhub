// Apply theme immediately on load
let savedTheme = "modern";
try {
    savedTheme = localStorage.getItem("anonhub-theme") || "modern";
} catch (e) {
    console.warn("localStorage is not accessible:", e);
}
document.documentElement.setAttribute("data-theme", savedTheme);

// Function to update the toggle button's text & icon
function updateThemeToggleButton(theme) {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    if (theme === "dark") {
        btn.innerHTML = "Light Mode";
        btn.setAttribute("aria-label", "Switch to Light Mode");
    } else {
        btn.innerHTML = "Dark Mode";
        btn.setAttribute("aria-label", "Switch to Dark Mode");
    }
}

// Update button state on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
    updateThemeToggleButton(document.documentElement.getAttribute("data-theme") || "modern");

    const toggleBtn = document.getElementById("theme-toggle");
    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
            const currentTheme = document.documentElement.getAttribute("data-theme") || "modern";
            const nextTheme = currentTheme === "dark" ? "modern" : "dark";

            document.documentElement.setAttribute("data-theme", nextTheme);
            updateThemeToggleButton(nextTheme);

            try {
                localStorage.setItem("anonhub-theme", nextTheme);
            } catch (e) {
                console.warn("Failed to save theme to localStorage:", e);
            }

            // Custom event so other scripts (like project workspace) can listen to theme changes!
            window.dispatchEvent(new CustomEvent("themeChanged", { detail: { theme: nextTheme } }));
        });
    }

    // Toggle Hamburger Menu on Mobile
    const menuToggle = document.getElementById("menu-toggle");
    const headerLinks = document.querySelector(".header-links");

    if (menuToggle && headerLinks) {
        menuToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            headerLinks.classList.toggle("show");

            // Toggle icon between ☰ and ✕
            if (headerLinks.classList.contains("show")) {
                menuToggle.innerHTML = "✕";
            } else {
                menuToggle.innerHTML = "☰";
            }
        });

        // Close menu when clicking anywhere else
        document.addEventListener("click", (e) => {
            if (!headerLinks.contains(e.target) && e.target !== menuToggle) {
                headerLinks.classList.remove("show");
                menuToggle.innerHTML = "☰";
            }
        });
    }
});
