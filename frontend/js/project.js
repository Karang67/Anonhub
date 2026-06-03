// frontend/js/project.js

// System diagnostics and early error logging
const earlySystemErrors = [];
window.addEventListener("error", function (event) {
  // Filter out harmless ResizeObserver loop limit warnings/errors
  if (event.message && (
    event.message.includes("ResizeObserver") ||
    event.message.includes("ResizeObserver loop") ||
    event.message.includes("Script error")
  )) {
    return;
  }

  // Filter out extension errors
  if (event.filename && (
    event.filename.startsWith("chrome-extension://") ||
    event.filename.startsWith("moz-extension://")
  )) {
    return;
  }

  const errorMsg = `[Runtime Error] ${event.message} at ${event.filename || 'unknown'}:${event.lineno || 0}`;
  console.error(errorMsg);
  const container = document.getElementById("system-notifications");
  if (container) {
    showNotification(errorMsg, "error");
  } else {
    earlySystemErrors.push({ message: errorMsg, type: "error" });
  }
});

function showNotification(message, type = "info") {
  const container = document.getElementById("system-notifications");
  if (!container) return;
  
  const note = document.createElement("div");
  note.className = `notification-${type}`;
  note.style.padding = "12px 18px";
  note.style.borderRadius = "8px";
  note.style.fontSize = "0.9rem";
  note.style.fontWeight = "600";
  note.style.display = "flex";
  note.style.alignItems = "center";
  note.style.justifyContent = "space-between";
  note.style.gap = "12px";
  note.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
  note.style.marginBottom = "10px";
  note.style.transition = "opacity 0.3s ease";
  
  if (type === "error") {
    note.style.background = "#fff1f0";
    note.style.color = "#ff4d4f";
    note.style.border = "1px solid #ffa39e";
  } else if (type === "warning") {
    note.style.background = "#fffbe6";
    note.style.color = "#d4b106";
    note.style.border = "1px solid #ffe58f";
  } else {
    note.style.background = "#e6f7ff";
    note.style.color = "#1890ff";
    note.style.border = "1px solid #91d5ff";
  }

  // Escape helper
  const escaped = String(message).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));

  note.innerHTML = `
    <span>${escaped}</span>
    <button style="background:transparent; border:none; color:inherit; font-size:1.2rem; cursor:pointer; font-weight:bold; padding:0 4px; line-height:1;" onclick="this.parentElement.remove()">×</button>
  `;
  container.appendChild(note);
}

let isWorkspaceInitialized = false;
function initWorkspace() {
  if (isWorkspaceInitialized) return;
  isWorkspaceInitialized = true;

  // Flush early errors
  earlySystemErrors.forEach(err => showNotification(err.message, err.type));

  (function () {
    // --- Globals & Resilient Socket.IO Setup ---
    let socket = null;
    if (typeof io !== 'undefined') {
      try {
        const getCookie = (name) => {
          const cookies = document.cookie.split(';');
          for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.startsWith(name + '=')) {
              return decodeURIComponent(cookie.substring(name.length + 1));
            }
          }
          return null;
        };
        const savedUsername = getCookie('anonhub-username') || sessionStorage.getItem('anonhub-username');
        socket = io({
          auth: {
            username: savedUsername
          }
        });
      } catch (e) {
        console.error("Socket.IO client failed to initialize:", e);
        showNotification("Socket.IO client failed to initialize. Working in offline mode.", "error");
      }
    } else {
      console.warn("Socket.IO library is not loaded. Working in offline mode.");
      showNotification("Connection library (Socket.IO) is not loaded. Working in offline mode.", "warning");
    }

    // Mock socket fallback
    if (!socket) {
      socket = {
        on: function (event, callback) {
          console.warn(`mockSocket.on('${event}') registered.`);
        },
        emit: function (event, data) {
          console.warn(`mockSocket.emit('${event}') called:`, data);
        }
      };
    }

    const canvasEl = document.getElementById("whiteboard");
    const projectTitle = document.getElementById("project-title");
    const textarea = document.getElementById("project-content");
    const chatForm = document.getElementById("project-chat-form");
    const chatInput = document.getElementById("project-chat-input");
    const chatMessages = document.getElementById("project-chat-messages");
    const userListEl = document.getElementById("user-list");
    const btnPen = document.getElementById("tool-pen");
    const btnSelect = document.getElementById("tool-select");
    const btnRect = document.getElementById("tool-rect");
    const btnCircle = document.getElementById("tool-circle");
    const brushSize = document.getElementById("brush-size");
    const brushColor = document.getElementById("brush-color");
    const btnClear = document.getElementById("clear-whiteboard");
    const btnExport = document.getElementById("export-whiteboard");
    const pathParts = window.location.pathname.split("/");
    let projectName =
      pathParts.length > 2 && pathParts[1] === "projects"
        ? decodeURIComponent(pathParts[2])
        : null;

    if (!projectName) {
      const urlParams = new URLSearchParams(window.location.search);
      projectName = urlParams.get('project');
    }

    function escapeHTML(s) {
      return String(s).replace(
        /[&<>"']/g,
        (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[m])
      );
    }

    if (!projectName) {
      if (projectTitle) projectTitle.textContent = "Project Not Found";
      if (textarea) {
        textarea.disabled = true;
        textarea.placeholder = "This project does not exist or the link is invalid.";
      }
      if (chatInput) chatInput.disabled = true;
      return;
    }

    if (projectTitle) {
      projectTitle.textContent = `Project: ${projectName}`;
    }

    // Shared editor and whiteboard states
    let canvas = null;
    let resizeCanvasToContainer = null;
    let editorInstance = null;
    let isEditorInitialized = false;
    let isRemoteChange = false;
    let loadedContent = "";
    let monacoEditorInstance = null;
    let isRemoteCodeChange = false;
    let loadedCodeContent = "";
    let loadedCodeLanguage = "javascript";
    const languageSelect = document.getElementById("code-language");

    // --- 1. Sockets & Chat Listeners (Bound early for reliability) ---
    
    const statusDot = document.getElementById("chat-status-dot");

    socket.on('set username', (name) => {
      document.cookie = `anonhub-username=${encodeURIComponent(name)}; path=/; SameSite=Lax`;
      sessionStorage.setItem('anonhub-username', name);
    });

    socket.on('connect_error', (err) => {
      if (statusDot) {
        statusDot.style.background = "#ff4d4f";
        statusDot.title = "Disconnected";
      }
      console.error("Socket connection error:", err);
      addChatMessageToDOM('System', `⚠️ Connection error: ${err.message || err}`, Date.now());
    });

    socket.on('connect', () => {
      if (statusDot) {
        statusDot.style.background = "#52c41a";
        statusDot.title = "Connected";
      }
      addChatMessageToDOM('System', '✅ Connected to server successfully.', Date.now());
    });

    socket.on('disconnect', (reason) => {
      if (statusDot) {
        statusDot.style.background = "#ff4d4f";
        statusDot.title = "Disconnected";
      }
      console.warn("Socket disconnected. Reason:", reason);
      addChatMessageToDOM('System', `⚠️ Disconnected from server (Reason: ${reason}).`, Date.now());
    });

    if (socket.io) {
      socket.io.on("error", (error) => {
        console.error("Socket manager error:", error);
        showNotification(`Socket manager error: ${error.message || error}`, "warning");
      });
      socket.io.on("reconnect_attempt", (attempt) => {
        console.log(`Socket reconnection attempt #${attempt}`);
      });
      socket.io.on("reconnect_failed", () => {
        console.error("Socket reconnection failed permanently.");
        showNotification("Reconnection failed permanently after all retries.", "error");
      });
    }

    if (chatForm) {
      chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        if (!chatInput) return;
        const raw = chatInput.value;
        const msg = raw && raw.trim();
        if (!msg) return;
        socket.emit("room message", { room: projectName, msg });
        chatInput.value = "";
      });
    }

    socket.on("load messages", (messagesArray) => {
      if (!chatMessages) return;
      chatMessages.innerHTML = "";
      if (!Array.isArray(messagesArray)) return;
      messagesArray.forEach((data) => {
        addChatMessageToDOM(data.username, data.msg, data.timestamp);
      });
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    socket.on("chat message", (data) => {
      if (!chatMessages) return;
      addChatMessageToDOM(data.username, data.msg, Date.now());
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    function addChatMessageToDOM(username, message, ts) {
      if (!chatMessages) return;
      const li = document.createElement("li");
      if (username === "System") {
        li.innerHTML = `<em>${escapeHTML(message)}</em>`;
        li.classList.add("system-message");
      } else {
        li.innerHTML = `<strong>${escapeHTML(
          username
        )}:</strong> ${escapeHTML(message)}`;
      }
      chatMessages.appendChild(li);
    }

    socket.on("room users", (usersArray) => {
      if (!userListEl) return;
      userListEl.innerHTML = "";
      if (!Array.isArray(usersArray)) return;
      usersArray.forEach((u) => {
        const li = document.createElement("li");
        li.innerHTML = `<span class="status-indicator"></span> ${escapeHTML(
          u.username
        )}`;
        userListEl.appendChild(li);
      });
    });

    // --- 2. Board Initializers ---

    // A. Sketch Board Setup
    function initWhiteboard() {
      if (!canvasEl) return;
      if (typeof fabric === 'undefined') {
        console.error("Fabric.js is not loaded. Drawing board will be disabled.");
        showNotification("Sketch Board drawing library (Fabric.js) failed to load. Drawing board is disabled.", "warning");
        const warningBox = document.createElement("div");
        warningBox.style.width = "100%";
        warningBox.style.height = "600px";
        warningBox.style.display = "flex";
        warningBox.style.alignItems = "center";
        warningBox.style.justifyContent = "center";
        warningBox.style.border = "1px solid var(--border-color)";
        warningBox.style.borderRadius = "12px";
        warningBox.style.background = "var(--card-background)";
        warningBox.style.color = "var(--text-color)";
        warningBox.style.fontSize = "1.1rem";
        warningBox.style.fontWeight = "600";
        warningBox.innerHTML = `⚠️ Sketch Board is disabled because Fabric.js CDN failed to load.`;
        if (canvasEl.parentElement) {
          canvasEl.parentElement.replaceChild(warningBox, canvasEl);
        }
        return;
      }

      resizeCanvasToContainer = function () {
        const paneEl = document.getElementById("pane-sketch");
        if (!paneEl) return;
        const targetWidth = paneEl.clientWidth;
        if (targetWidth === 0) return; // Guard against hidden/zero-width measurements
        const targetHeight = 600;
        if (canvas) {
          canvas.setWidth(targetWidth);
          canvas.setHeight(targetHeight);
          canvas.calcOffset();
          canvas.renderAll();
        }
      };

      canvas = new fabric.Canvas("whiteboard", {
        isDrawingMode: true,
        backgroundColor: "#ffffff",
        preserveObjectStacking: true,
      });

      if (canvas.freeDrawingBrush && brushSize && brushColor) {
        canvas.freeDrawingBrush.width = parseInt(brushSize.value, 10) || 3;
        canvas.freeDrawingBrush.color = brushColor.value || "#000";
      }

      const paneEl = document.getElementById("pane-sketch");
      setTimeout(() => {
        if (typeof resizeCanvasToContainer === 'function') resizeCanvasToContainer();
      }, 100);

      if (typeof ResizeObserver !== 'undefined' && paneEl) {
        const ro = new ResizeObserver(() => {
          if (typeof resizeCanvasToContainer === 'function') resizeCanvasToContainer();
        });
        ro.observe(paneEl);
      } else {
        window.addEventListener("resize", () => {
          if (typeof resizeCanvasToContainer === 'function') resizeCanvasToContainer();
        });
      }

      if (btnPen) {
        btnPen.addEventListener("click", () => {
          canvas.isDrawingMode = true;
        });
      }
      if (btnSelect) {
        btnSelect.addEventListener("click", () => {
          canvas.isDrawingMode = false;
        });
      }
      if (btnRect && brushColor) {
        btnRect.addEventListener("click", () => {
          canvas.isDrawingMode = false;
          const rect = new fabric.Rect({
            left: 50,
            top: 50,
            width: 120,
            height: 80,
            fill: "transparent",
            stroke: brushColor.value,
            strokeWidth: 2,
          });
          canvas.add(rect);
          emitCanvasChange();
        });
      }
      if (btnCircle && brushColor) {
        btnCircle.addEventListener("click", () => {
          canvas.isDrawingMode = false;
          const circle = new fabric.Circle({
            left: 80,
            top: 80,
            radius: 40,
            fill: "transparent",
            stroke: brushColor.value,
            strokeWidth: 2,
          });
          canvas.add(circle);
          emitCanvasChange();
        });
      }
      if (brushSize) {
        brushSize.addEventListener("input", () => {
          if (canvas.freeDrawingBrush) {
            canvas.freeDrawingBrush.width = parseInt(brushSize.value, 10);
          }
        });
      }
      if (brushColor) {
        brushColor.addEventListener("input", () => {
          if (canvas.freeDrawingBrush) {
            canvas.freeDrawingBrush.color = brushColor.value;
          }
        });
      }
      if (btnClear) {
        btnClear.addEventListener("click", () => {
          if (!confirm("Clear the whiteboard for everyone?")) return;
          isApplyingRemote = true;
          canvas.clear();
          canvas.backgroundColor = "#ffffff";
          isApplyingRemote = false;
          _emitCanvasJSON();
        });
      }
      if (btnExport) {
        btnExport.addEventListener("click", () => {
          const json = JSON.stringify(canvas.toJSON(["selectable"]));
          const data = "text/json;charset=utf-8," + encodeURIComponent(json);
          const a = document.createElement("a");
          a.href = "data:" + data;
          a.download = `${projectName}-whiteboard.json`;
          a.click();
        });
      }

      let isApplyingRemote = false;
      let lastEmit = 0;

      function emitCanvasChange() {
        if (!canvas) return;
        const now = Date.now();
        if (now - lastEmit < 300) {
          if (canvas.__emitTimeout) clearTimeout(canvas.__emitTimeout);
          canvas.__emitTimeout = setTimeout(() => {
            canvas.__emitTimeout = null;
            _emitCanvasJSON();
          }, 300 - (now - lastEmit));
        } else {
          _emitCanvasJSON();
        }
      }

      function _emitCanvasJSON() {
        if (!canvas) return;
        lastEmit = Date.now();
        const json = JSON.stringify(canvas.toJSON(["selectable"]));
        socket.emit("whiteboard update", { projectName, content: json });
      }

      canvas.on("path:created", () => {
        if (!isApplyingRemote) emitCanvasChange();
      });
      canvas.on("object:added", () => {
        if (!isApplyingRemote) emitCanvasChange();
      });
      canvas.on("object:modified", () => {
        if (!isApplyingRemote) emitCanvasChange();
      });
      canvas.on("object:removed", () => {
        if (!isApplyingRemote) emitCanvasChange();
      });

      socket.on("whiteboard content", (content) => {
        if (!canvas) return;
        try {
          if (!content) return;
          isApplyingRemote = true;
          const parsed = JSON.parse(content);
          if (!parsed.objects) {
            parsed.objects = [];
          }
          canvas.loadFromJSON(
            parsed,
            () => {
              canvas.renderAll();
              isApplyingRemote = false;
            },
            function (o, object) { }
          );
        } catch (err) {
          console.error("Failed to load whiteboard content:", err);
          isApplyingRemote = false;
        }
      });
    }

    // B. Document Board Setup
    function getTinyMCEThemeOptions(themeName) {
      const isDark = themeName === "dark";
      return {
        skin: isDark ? "oxide-dark" : "oxide",
        content_css: isDark ? "dark" : "default"
      };
    }

    function initTinyMCE(themeName, initialValue = "") {
      const themeOpts = getTinyMCEThemeOptions(themeName);
      
      tinymce.init({
        selector: "#project-content",
        plugins: "advlist autolink lists link image charmap preview anchor searchreplace visualblocks code fullscreen insertdatetime media table code help wordcount emoticons",
        toolbar: "undo redo | blocks | bold italic backcolor | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | removeformat | table emoticons code fullscreen",
        height: 600,
        skin: themeOpts.skin,
        content_css: themeOpts.content_css,
        branding: false,
        promotion: false,
        setup: function (editor) {
          editorInstance = editor;

          editor.on("init", () => {
            isEditorInitialized = true;
            const valToSet = initialValue || loadedContent;
            if (valToSet) {
              editor.setContent(valToSet);
            }
          });

          let updateTimeout = null;
          editor.on("keyup Change ExecCommand input", () => {
            if (isRemoteChange) return;
            
            if (updateTimeout) clearTimeout(updateTimeout);
            updateTimeout = setTimeout(() => {
              if (editorInstance && isEditorInitialized) {
                const currentHtml = editorInstance.getContent();
                socket.emit("project update", {
                  projectName,
                  content: currentHtml,
                });
              }
            }, 400);
          });
        }
      });
    }

    function initDocumentBoard() {
      if (!textarea) return;
      if (typeof tinymce === 'undefined') {
        console.warn("TinyMCE is not loaded. Falling back to plain textarea collaboration.");
        showNotification("Document Board rich-text library (TinyMCE) failed to load. Falling back to plain text collaboration.", "warning");
        textarea.style.width = "100%";
        textarea.style.height = "600px";
        textarea.disabled = false;
        textarea.placeholder = "Start collaborating on your plain-text project here...";
        
        // Bind input sync
        let updateTimeout = null;
        textarea.addEventListener("input", () => {
          if (updateTimeout) clearTimeout(updateTimeout);
          updateTimeout = setTimeout(() => {
            socket.emit("project update", {
              projectName,
              content: textarea.value
            });
          }, 400);
        });

        socket.on("project content", (content) => {
          if (content === undefined || content === null) return;
          loadedContent = content;
          if (textarea.value !== content) {
            textarea.value = content;
          }
        });
        return;
      }

      let initialTheme = "modern";
      try {
        initialTheme = localStorage.getItem("anonhub-theme") || "modern";
      } catch (e) {}
      initTinyMCE(initialTheme);

      socket.on("project content", (content) => {
        if (content === undefined || content === null) return;
        loadedContent = content; // Cache latest
        
        if (!editorInstance || !isEditorInitialized) {
          textarea.value = content;
          return;
        }

        if (editorInstance.getContent() !== content) {
          isRemoteChange = true;
          
          let bookmark = null;
          try {
            bookmark = editorInstance.selection.getBookmark(2, true);
          } catch (e) {
            // Ignore selection errors
          }

          editorInstance.setContent(content);

          if (bookmark) {
            try {
              editorInstance.selection.moveToBookmark(bookmark);
            } catch (e) {
              // Ignore boundary errors
            }
          }
          
          isRemoteChange = false;
        }
      });
    }

    // C. Coding Board Setup
    function initCodingBoard() {
      const codeEditorEl = document.getElementById("code-editor");
      if (!codeEditorEl) return;
      if (typeof require === 'undefined' || typeof require.config !== 'function') {
        console.warn("Monaco Editor loader is not loaded. Falling back to plain text code editor.");
        showNotification("Coding Board editor library (Monaco) failed to load. Falling back to plain text editor.", "warning");
        
        const fallbackArea = document.createElement("textarea");
        fallbackArea.id = "code-editor-fallback";
        fallbackArea.style.width = "100%";
        fallbackArea.style.maxWidth = "100%";
        fallbackArea.style.height = "600px";
        fallbackArea.style.fontFamily = "monospace";
        fallbackArea.style.padding = "16px";
        fallbackArea.style.fontSize = "14px";
        fallbackArea.style.boxSizing = "border-box";
        fallbackArea.style.borderRadius = "12px";
        fallbackArea.style.border = "1px solid var(--border-color)";
        fallbackArea.style.background = "#1e1e1e";
        fallbackArea.style.color = "#d4d4d4";
        fallbackArea.value = loadedCodeContent || '// Start coding in plain text mode here...\n';
        codeEditorEl.appendChild(fallbackArea);

        fallbackArea.addEventListener("input", () => {
          socket.emit("code update", {
            projectName,
            code: fallbackArea.value,
            language: languageSelect ? languageSelect.value : 'javascript'
          });
        });

        socket.on("code content", (data) => {
          if (!data) return;
          const { code, language } = data;
          loadedCodeContent = code;
          loadedCodeLanguage = language;
          if (fallbackArea.value !== code) {
            fallbackArea.value = code;
          }
        });
        return;
      }
      if (!languageSelect) return;

      require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
      require(['vs/editor/editor.main'], function () {
        let currentTheme = "modern";
        try {
          currentTheme = localStorage.getItem("anonhub-theme") || "modern";
        } catch (e) {}
        const monacoTheme = currentTheme === "dark" ? "vs-dark" : "vs";

        monacoEditorInstance = monaco.editor.create(document.getElementById('code-editor'), {
          value: loadedCodeContent || '// Start coding in VS Code style here...\n',
          language: loadedCodeLanguage,
          theme: monacoTheme,
          automaticLayout: true,
          fontSize: 14,
          fontFamily: "'Courier New', Courier, monospace",
          minimap: { enabled: true },
          lineNumbers: "on",
          roundedSelection: true,
          scrollBeyondLastLine: false,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on"
        });

        // Handle local code modifications
        let codeUpdateTimeout = null;
        monacoEditorInstance.onDidChangeModelContent((event) => {
          if (isRemoteCodeChange) return;

          if (codeUpdateTimeout) clearTimeout(codeUpdateTimeout);
          codeUpdateTimeout = setTimeout(() => {
            if (monacoEditorInstance && languageSelect) {
              const code = monacoEditorInstance.getValue();
              const language = languageSelect.value;
              socket.emit("code update", {
                projectName,
                code,
                language
              });
            }
          }, 400);
        });
      });

      // Language Select dropdown handler
      languageSelect.addEventListener("change", () => {
        const selectedLang = languageSelect.value;
        if (monacoEditorInstance) {
          const model = monacoEditorInstance.getModel();
          if (model) {
            monaco.editor.setModelLanguage(model, selectedLang);
          }
          const code = monacoEditorInstance.getValue();
          socket.emit("code update", {
            projectName,
            code,
            language: selectedLang
          });
        }
      });

      socket.on("code content", (data) => {
        if (!data) return;
        const { code, language } = data;
        loadedCodeContent = code;
        loadedCodeLanguage = language;

        if (languageSelect && languageSelect.value !== language) {
          languageSelect.value = language;
        }

        if (!monacoEditorInstance) return;

        const model = monacoEditorInstance.getModel();
        if (model && model.getLanguageId() !== language) {
          monaco.editor.setModelLanguage(model, language);
        }

        if (monacoEditorInstance.getValue() !== code) {
          isRemoteCodeChange = true;
          
          const state = monacoEditorInstance.saveViewState();
          monacoEditorInstance.setValue(code);
          if (state) {
            monacoEditorInstance.restoreViewState(state);
          }
          
          isRemoteCodeChange = false;
        }
      });
    }

    // --- 3. Run Initializers Safely ---
    try {
      initWhiteboard();
    } catch (e) {
      console.error("Sketch Board error:", e);
    }

    try {
      initDocumentBoard();
    } catch (e) {
      console.error("Document Board error:", e);
    }

    try {
      initCodingBoard();
    } catch (e) {
      console.error("Coding Board error:", e);
    }

    // --- 4. Tab & Theme Switchers ---
    const tabSketch = document.getElementById("tab-sketch");
    const tabDocument = document.getElementById("tab-document");
    const tabCode = document.getElementById("tab-code");
    const paneSketch = document.getElementById("pane-sketch");
    const paneDocument = document.getElementById("pane-document");
    const paneCode = document.getElementById("pane-code");

    if (tabSketch && paneSketch && paneDocument && paneCode) {
      tabSketch.addEventListener("click", () => {
        tabSketch.classList.add("active");
        if (tabDocument) tabDocument.classList.remove("active");
        if (tabCode) tabCode.classList.remove("active");
        paneSketch.classList.add("active");
        paneDocument.classList.remove("active");
        paneCode.classList.remove("active");
        if (canvas) {
          if (typeof resizeCanvasToContainer === 'function') {
            resizeCanvasToContainer();
          } else {
            canvas.calcOffset();
            canvas.renderAll();
          }
        }
      });
    }

    if (tabDocument && paneSketch && paneDocument && paneCode) {
      tabDocument.addEventListener("click", () => {
        tabDocument.classList.add("active");
        if (tabSketch) tabSketch.classList.remove("active");
        if (tabCode) tabCode.classList.remove("active");
        paneDocument.classList.add("active");
        paneSketch.classList.remove("active");
        paneCode.classList.remove("active");
      });
    }

    if (tabCode && paneSketch && paneDocument && paneCode) {
      tabCode.addEventListener("click", () => {
        tabCode.classList.add("active");
        if (tabSketch) tabSketch.classList.remove("active");
        if (tabDocument) tabDocument.classList.remove("active");
        paneCode.classList.add("active");
        paneSketch.classList.remove("active");
        paneDocument.classList.remove("active");
        if (monacoEditorInstance) {
          setTimeout(() => {
            monacoEditorInstance.layout();
          }, 100);
        }
      });
    }

    window.addEventListener("themeChanged", (e) => {
      const theme = e.detail.theme;
      if (editorInstance && isEditorInitialized && typeof tinymce !== 'undefined') {
        const currentContent = editorInstance.getContent();
        isEditorInitialized = false;
        editorInstance = null;
        tinymce.remove("#project-content");
        initTinyMCE(theme, currentContent);
      }
      if (typeof monaco !== 'undefined') {
        const monacoTheme = theme === "dark" ? "vs-dark" : "vs";
        monaco.editor.setTheme(monacoTheme);
      }
    });

    // Emit initial join event
    socket.emit("join project", projectName);

    // Beforeunload cleanup
    window.addEventListener("beforeunload", () => {
      try {
        if (editorInstance && isEditorInitialized) {
          socket.emit("project update", {
            projectName,
            content: editorInstance.getContent(),
          });
        } else if (textarea) {
          socket.emit("project update", {
            projectName,
            content: textarea.value,
          });
        }
        if (monacoEditorInstance && languageSelect) {
          socket.emit("code update", {
            projectName,
            code: monacoEditorInstance.getValue(),
            language: languageSelect.value
          });
        }
        if (canvas) {
          const json = JSON.stringify(canvas.toJSON(["selectable"]));
          socket.emit("whiteboard update", { projectName, content: json });
        }
      } catch (e) { }
    });
  })();
}

document.addEventListener("DOMContentLoaded", function () {
  const urlParams = new URLSearchParams(window.location.search);
  const pathParts = window.location.pathname.split("/");
  const hasPathProj = pathParts.length > 2 && pathParts[1] === "projects";
  const hasQueryProj = urlParams.has('project');
  
  if (!hasPathProj && !hasQueryProj) {
    // We are on a page (like document.html) without a project parameter yet.
    // The page-specific overlay script will handle input prompting.
    return;
  }

  if (typeof io === 'undefined') {
    loadSocketFallback(initWorkspace);
  } else {
    initWorkspace();
  }
});

function loadSocketFallback(callback) {
  console.warn("connection-helper.js not found. Trying local socket.io route...");
  
  // Temporarily hide define for fallback scripts
  const tempDefine = window.define;
  window.define = undefined;

  const s = document.createElement("script");
  s.src = "/socket.io/socket.io.js";
  s.onload = function () {
    window.define = tempDefine;
    console.log("Socket.IO client loaded from local fallback.");
    callback();
  };
  s.onerror = function () {
    console.warn("Local socket.io script failed. Trying CDN fallback...");
    const s2 = document.createElement("script");
    s2.src = "https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.2/socket.io.min.js";
    s2.onload = function () {
      window.define = tempDefine;
      console.log("Socket.IO client loaded from CDN.");
      callback();
    };
    s2.onerror = function () {
      window.define = tempDefine;
      console.error("Socket.IO CDN failed to load.");
      callback();
    };
    document.head.appendChild(s2);
  };
  document.head.appendChild(s);
  
  // Safety timeout: initialize anyway if loading hangs
  setTimeout(() => {
    window.define = tempDefine;
    callback();
  }, 3000);
}
