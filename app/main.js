import {app, session, Menu, BrowserWindow, dialog, nativeImage, shell, Tray} from "electron";
import {clearActivity, setActivity, loginToRPC} from "./config/rpc.js";
import {initialize, trackEvent} from "@aptabase/electron/main";
import {ElectronBlocker} from "@cliqz/adblocker-electron";
import {setValue, getValue} from "./config/store.js";
import {dirname, join} from "path";
import {fileURLToPath} from "url";
import path from "path";
import {getScreenWidth, getScreenHeight} from "./config/dimensions.js";
import checkInternetConnected from "check-internet-connected";
import domains from "./domains.json" with {type: "json"};
import contextMenu from "electron-context-menu";
import updaterpkg from "electron-updater";
import ElectronDl from "electron-dl";
import menulayout from "./config/menu.js";
import logpkg from "electron-log";
import dns from 'dns';

const {transports, log: _log, functions} = logpkg;
const __filename = fileURLToPath(import.meta.url);
const windowHeight = getValue("windowHeight");
const windowWidth = getValue("windowWidth");
const __dirname = dirname(__filename);
const {autoUpdater} = updaterpkg;
let mainWindow;
let tray;
transports.file.level = "verbose";
console.log = _log;
Object.assign(console, functions);

// 添加错误处理函数
function handleError(error) {
    console.error('An error occurred:', error);
    dialog.showErrorBox('Error', `An error occurred: ${error.message}`);
}

// 放置错误处理器
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // 可以在这里添加更多的错误处理逻辑，比如显示一个对话框
    dialog.showErrorBox('An error occurred', error.message);
});
if (getValue("aptabaseTracking") === true) {
    initialize("A-US-2528580917").catch((error) => {
        console.error("Error initializing:", error);
    });
}

// 添加兼容的缓存设置函数
function setupCompatibleCaching() {
    try {
        const userDataPath = app.getPath('userData');
        console.log('User data path:', userDataPath);

        const cachePath = path.join(userDataPath, 'Cache');
        console.log('Cache path:', cachePath);

        // 尝试使用其他方法设置缓存
        if (session.defaultSession.cookies) {
            console.log('Setting up cookie persistence...');
            session.defaultSession.cookies.set({
                url: 'https://microsoft365.com',
                name: 'cacheTest',
                value: 'true',
                expirationDate: Date.now() + 365 * 24 * 60 * 60 * 1000
            }).then(() => {
                console.log('Cookie persistence set up successfully');
            }).catch(error => {
                console.error('Failed to set up cookie persistence:', error);
            });
        }

        // 设置 HTTP 缓存
        console.log('Setting up HTTP cache...');
        session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
            if (!details.requestHeaders['Cache-Control']) {
                details.requestHeaders['Cache-Control'] = 'max-age=3600, public';
                console.log('Added Cache-Control header for URL:', details.url);
            } else {
                console.log('Cache-Control header already exists for URL:', details.url);
            }
            callback({requestHeaders: details.requestHeaders, 'Content-Security-Policy': ["default-src 'self'"]});
        });

        console.log('HTTP cache setup completed');

        // 清理超过3天的 Service Worker 存储
        if (session.defaultSession.clearStorageData) {
            console.log('Attempting to clear old Service Worker storage...');
            const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
            session.defaultSession.clearStorageData({
                storages: ['serviceworkers'],
                quotas: ['temporary'],
                origin: '*',
                time: threeDaysAgo
            }).then(() => {
                console.log('Old Service Worker storage cleared successfully');
            }).catch(error => {
                console.error('Failed to clear old Service Worker storage:', error);
            });
        }
        console.log('Caching setup completed successfully');
    } catch (error) {
        console.error('Error in setupCompatibleCaching:', error);
        handleError(error);
    }
}

function handleUnhandledRejection(reason, promise) {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    dialog.showErrorBox('Unhandled Promise Rejection', `An error occurred: ${reason}`);
}

let retryCount = 0;
const maxRetries = 3;

function loadURLWithRetry(url) {
    // 获取调用栈信息
    const stack = new Error().stack;
    // 解析调用栈以获取调用者函数名
    const caller = stack.split('\n')[2].trim().split(' ')[1];
    // 检查 URL 是否为空
    if (!url) {
        console.warn(`[${caller}] URL is empty or null. Skipping load.`);
        return;
    }
    mainWindow.loadURL(url).catch(error => {
        console.error('!Failed to load URL: %s', url);
        console.error('!Error details: %s', util.inspect(error, {depth: null, colors: true}));
        console.error('!Error stack trace:');
        console.error(error.stack);
        if (error.errno) {
            console.error('System error number: %s', error.errno);
        }
        if (error.code) {
            console.error('Error code: %s', error.code);
        }
        if (error.syscall) {
            console.error('System call: %s', error.syscall);
        }
        // 如果错误是由网络问题引起的，可能会有更多特定的属性
        if (error.address) {
            console.error('Remote address: %s', error.address);
        }
        if (error.port) {
            console.error('Remote port: %s', error.port);
        }
        // 记录当前的系统状态
        console.error('Current system time: %s', new Date().toISOString());
        console.error('Process memory usage: %j', process.memoryUsage());
        console.error('System uptime: %d seconds', Math.floor(process.uptime()));
    });
}

function createWindow() {
    const enterpriseOrNormal = getValue("enterprise-or-normal");
    const custompage = getValue("custompage");
    const partition = enterpriseOrNormal === "?auth=1" ? "persist:personal" : "persist:work";

    const win = new BrowserWindow({
        width: Math.round(getScreenWidth() * getValue("windowWidth")),
        height: Math.round(getScreenHeight() * getValue("windowHeight")),
        icon: join(__dirname, "/assets/icons/png/1024x1024.png"),
        show: false,
        webPreferences: {
            nodeIntegration: true,
            devTools: true,
            contextIsolation: true,
            partition: partition,
            preload: path.join(__dirname, 'preload.js')
        },
    });
    mainWindow = win;  // 保存对主窗口的引用
    win.setAutoHideMenuBar(getValue("autohide-menubar") === "true");

    const splash = new BrowserWindow({
        width: Math.round(getScreenWidth() * 0.49),
        height: Math.round(getScreenHeight() * 0.65),
        transparent: true,
        frame: false,
        icon: join(__dirname, "/assets/icons/png/1024x1024.png"),
    });
    loadURLWithRetry(`https://microsoft365.com/${custompage}/${enterpriseOrNormal}`);
    win.webContents.on("did-finish-load", () => {
        splash.destroy();
        win.show();
        setupCompatibleCaching();
        if (getValue("aptabaseTracking") === true) {
            trackEvent("app_started").catch((error) => {
                console.error("Error tracking event:", error);
            });
        }
        if (getValue("discordrpcstatus") === "true") {
            setActivity(`On "${win.webContents.getTitle()}"`);
        }
        if (getValue("blockadsandtrackers") === "true") {
            ElectronBlocker.fromPrebuiltAdsAndTracking(fetch).then((blocker) => {
                blocker.enableBlockingInSession(win.webContents.session);
            });
        }
    });
    win.on('close', function (event) {
        if (!app.isQuitting) {
            event.preventDefault();
            win.hide();
            return false;
        }
    });
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        console.error('Failed to load URL:', validatedURL, 'Error:', errorDescription);
        // if (retryCount < maxRetries) {
        //     retryCount++;
        //     console.log(`Retrying... Attempt ${retryCount} of ${maxRetries}`);
        //     setTimeout(() => loadURLWithRetry(url), 1000); // 1秒后重试
        // } else {
        //     dialog.showErrorBox('加载失败', `在 ${maxRetries} 次尝试后仍然无法加载页面。`);
        //     retryCount = 0;
        // }
        // if (isMainFrame) {
        // dialog.showErrorBox('Page Load Failed', `Failed to load ${validatedURL}. Error: ${errorDescription}`);
        // 可以选择重新加载页面或加载一个错误页面
        // win.loadFile('error.html'); // 确保你有一个 error.html 文件
        // }
    });
}

ElectronDl({
    dlPath: "./downloads",
    onStarted: (item) => {
        dialog.showMessageBox({
            type: "info",
            title: "Downloading File",
            message: `Downloading "${item.getFilename()}" to "${item.getSavePath()}"`,
            buttons: ["OK"],
        });
    },
    onCompleted: () => {
        dialog.showMessageBox({
            type: "info",
            title: "Download Completed",
            message: `Downloading Completed! Please check your "Downloads" folder.`,
            buttons: ["OK"],
        });
    },
    onError: (item) => {
        dialog.showMessageBox({
            type: "error",
            title: "Download failed",
            message: `Downloading "${item.getFilename()}" failed :(`,
            buttons: ["OK"],
        });
    },
});

contextMenu({
    showInspectElement: true,
    showServices: true,
});

function createMainWindow() {
    const enterpriseOrNormal = getValue("enterprise-or-normal");
    const custompage = getValue("custompage");
    const partition = enterpriseOrNormal === "?auth=1" ? "persist:personal" : "persist:work";

    mainWindow = new BrowserWindow({
        width: Math.round(getScreenWidth() * getValue("windowWidth")),
        height: Math.round(getScreenHeight() * getValue("windowHeight")),
        icon: path.join(app.getAppPath(), 'assets', 'icons', 'png', '1024x1024.png'),
        webPreferences: {
            nodeIntegration: true,
            devTools: true,
            partition: partition,
        },
    });

    mainWindow.loadURL(`https://microsoft365.com/${custompage}/${enterpriseOrNormal}`);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function createTray() {
    let trayIcon;
    try {
        const iconPath = path.join(app.getAppPath(), 'assets', 'icons', 'png', '16x16.png');
        trayIcon = nativeImage.createFromPath(iconPath);

        if (trayIcon.isEmpty()) {
            throw new Error('Tray icon is empty');
        }
    } catch (error) {
        console.error('Failed to load tray icon:', error);
        trayIcon = nativeImage.createEmpty();
    }

    const tray = new Tray(trayIcon);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '显示',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    if (getValue("discordrpcstatus") === "true") {
                        setActivity(`On "${mainWindow.webContents.getTitle()}"`);
                    }
                } else {
                    createMainWindow();
                }
            }
        },
        {type: 'separator'},
        {
            label: 'Word',
            click: () => openApp('word')
        },
        {
            label: 'Excel',
            click: () => openApp('excel')
        },
        {
            label: 'PowerPoint',
            click: () => openApp('powerpoint')
        },
        {
            label: 'Outlook',
            click: () => openApp('outlook')
        },
        {
            label: 'OneDrive',
            click: () => openApp('onedrive')
        },
        {
            label: 'OneNote',
            click: () => openApp('onenote')
        },
        {
            label: 'Teams',
            click: () => openApp('teams')
        },
        {
            label: 'All Apps',
            click: () => openApp('allapps')
        },
        {type: 'separator'},
        {
            label: 'Exit',
            click: () => {
                app.isQuitting = true;
                clearActivity();
                app.quit();
            }
        }
    ]);

    tray.setToolTip('Microsoft 365 Electron');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (mainWindow) {
            mainWindow.show();
        } else {
            createMainWindow();
        }
    });

    return tray;
}

function openApp(appName) {
    const enterpriseOrNormal = getValue("enterprise-or-normal");
    const windowWidth = getValue("windowWidth");
    const windowHeight = getValue("windowHeight");
    let url;

    switch (appName) {
        case 'word':
            url = `https://microsoft365.com/launch/word${enterpriseOrNormal}`;
            break;
        case 'excel':
            url = `https://microsoft365.com/launch/excel${enterpriseOrNormal}`;
            break;
        case 'powerpoint':
            url = `https://microsoft365.com/launch/powerpoint${enterpriseOrNormal}`;
            break;
        case 'outlook':
            url = `https://outlook.live.com/mail/0/`;
            break;
        case 'onedrive':
            url = `https://microsoft365.com/launch/onedrive${enterpriseOrNormal}`;
            break;
        case 'onenote':
            url = enterpriseOrNormal === "?auth=2" ? "https://www.microsoft365.com/launch/onenote?auth=2" : "https://www.onenote.com/notebooks?auth=1";
            break;
        case 'allapps':
            url = `https://www.microsoft365.com/apps${enterpriseOrNormal}`;
            break;
        case 'teams':
            url = `https://teams.live.com/v2/`;
            break;
    }

    if (getValue("websites-in-new-window") === "true" || !mainWindow) {
        let newWindow = new BrowserWindow({
            width: Math.round(getScreenWidth() * (windowWidth - 0.07)),
            height: Math.round(getScreenHeight() * (windowHeight - 0.07)),
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                partition: enterpriseOrNormal === "?auth=1" ? "persist:personal" : "persist:work",
            },
        });
        newWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
            console.error(`Failed to load ${appName}:`, validatedURL, 'Error:', errorDescription);
        });
        newWindow.loadURL(url).catch(error => {
            console.error(`Error loading ${appName}:`, error);
        });
    } else {
        mainWindow.loadURL(url);
    }

    if (getValue("discordrpcstatus") === "true") {
        setActivity(`On ${appName.charAt(0).toUpperCase() + appName.slice(1)}`);
    }
}

Menu.setApplicationMenu(Menu.buildFromTemplate(menulayout));

app.on("ready", () => {
    dns.lookup('microsoft.com', (err) => {
        if (err && err.code === 'ENOTFOUND') {
            dialog.showErrorBox('网络错误', '无法连接到互联网。请检查你的网络连接。');
        } else {
            createWindow();
        }
    });
    createTray();
    const mySession = session.defaultSession;
    // 替代 setCacheLimit
    mySession.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['Cache-Control'] = 'max-age=3600';
        callback({requestHeaders: details.requestHeaders});
    });
    if (getValue("aptabaseTracking") === null) {
        const aptabasedialog = dialog.showMessageBoxSync({
            type: "question",
            buttons: ["Yes", "No"],
            title: "Enable Aptabase Tracking",
            message: "Would you like to enable Aptabase Tracking?",
            detail:
                "Aptabase Tracking helps us improve the app by collecting anonymous usage data. No personal information is collected.\n\nYou can always enable or disable this in the app menu.",
        });
        if (aptabasedialog === 0) {
            setValue("aptabaseTracking", true);
        } else {
            setValue("aptabaseTracking", false);
        }
    }
    process.on('unhandledRejection', (reason, promise) => {
        console.log('Unhandled Rejection at:', promise, 'reason:', reason);
    });
});

app.on("web-contents-created", (event, contents) => {
    contents.setWindowOpenHandler(({url}) => {
        const urlObject = new URL(url);
        const domain = urlObject.hostname;
        const protocol = urlObject.protocol;

        if (getValue("externalLinks") === "true") {
            if (protocol === "http:" || protocol === "https:") {
                const isAllowedDomain = domains.domains.some((allowedDomain) =>
                    new RegExp(`^${allowedDomain.replace("*.", ".*")}$`).test(domain)
                );

                if (isAllowedDomain) {
                    if (getValue("websites-in-new-window") === "false") {
                        if (url.includes("page=Download")) return {action: "allow"};
                        BrowserWindow.getFocusedWindow().loadURL(url).catch();
                        if (getValue("discordrpcstatus") === "true") {
                            setActivity(`On "${BrowserWindow.getFocusedWindow().webContents.getTitle()}"`);
                        }
                        return {action: "deny"};
                    } else {
                        if (getValue("discordrpcstatus") === "true") {
                            setActivity(`On "${BrowserWindow.getFocusedWindow().webContents.getTitle()}"`);
                        }
                        return {
                            action: "allow",
                            overrideBrowserWindowOptions: {
                                width: Math.round(getScreenWidth() * (windowWidth - 0.07)),
                                height: Math.round(getScreenHeight() * (windowHeight - 0.07)),
                            },
                        };
                    }
                } else {
                    shell.openExternal(url);
                    return {action: "deny"};
                }
            } else {
                return {action: "deny"};
            }
        } else {
            if (getValue("websites-in-new-window") === "false") {
                if (url.includes("page=Download")) return {action: "allow"};
                BrowserWindow.getFocusedWindow().loadURL(url).catch();
                if (getValue("discordrpcstatus") === "true") {
                    setActivity(`On "${BrowserWindow.getFocusedWindow().webContents.getTitle()}"`);
                }
                return {action: "deny"};
            } else {
                if (getValue("discordrpcstatus") === "true") {
                    setActivity(`On "${BrowserWindow.getFocusedWindow().webContents.getTitle()}"`);
                }
                return {
                    action: "allow",
                    overrideBrowserWindowOptions: {
                        width: Math.round(getScreenWidth() * (windowWidth - 0.07)),
                        height: Math.round(getScreenHeight() * (windowHeight - 0.07)),
                    },
                };
            }
        }
    });
    contents.on("did-finish-load", () => {
        if (getValue("dynamicicons") === "true") {
            if (BrowserWindow.getFocusedWindow()) {
                if (
                    BrowserWindow.getFocusedWindow().webContents.getURL().includes("&ithint=file%2cpptx") ||
                    BrowserWindow.getFocusedWindow().webContents.getTitle().includes(".pptx")
                ) {
                    if (process.platform === "darwin") {
                        app.dock.setIcon(join(__dirname, "../assets/icons/apps/powerpoint-mac.png"));
                    } else if (process.platform === "win32") {
                        let nimage = nativeImage.createFromPath(
                            join(__dirname, "../assets/icons/apps/powerpoint.png")
                        );
                        BrowserWindow.getAllWindows().forEach((window) => {
                            window.setOverlayIcon(nimage, "PowerPoint");
                        });
                    }
                } else if (
                    BrowserWindow.getFocusedWindow().webContents.getURL().includes("&ithint=file%2cdocx") ||
                    BrowserWindow.getFocusedWindow().webContents.getTitle().includes(".docx")
                ) {
                    if (process.platform === "darwin") {
                        app.dock.setIcon(join(__dirname, "../assets/icons/apps/word-mac.png"));
                    } else if (process.platform === "win32") {
                        let nimage = nativeImage.createFromPath(
                            join(__dirname, "../assets/icons/apps/word.png")
                        );
                        BrowserWindow.getAllWindows().forEach((window) => {
                            window.setOverlayIcon(nimage, "Word");
                        });
                    }
                } else if (
                    BrowserWindow.getFocusedWindow().webContents.getURL().includes("&ithint=file%2cxlsx") ||
                    BrowserWindow.getFocusedWindow().webContents.getTitle().includes(".xlsx")
                ) {
                    if (process.platform === "darwin") {
                        app.dock.setIcon(join(__dirname, "../assets/icons/apps/excel-mac.png"));
                    } else if (process.platform === "win32") {
                        let nimage = nativeImage.createFromPath(
                            join(__dirname, "../assets/icons/apps/excel.png")
                        );
                        BrowserWindow.getAllWindows().forEach((window) => {
                            window.setOverlayIcon(nimage, "Excel");
                        });
                    }
                } else if (
                    BrowserWindow.getFocusedWindow().webContents.getURL().includes("outlook.live.com") ||
                    BrowserWindow.getFocusedWindow().webContents.getURL().includes("outlook.office.com")
                ) {
                    if (process.platform === "darwin") {
                        app.dock.setIcon(join(__dirname, "../assets/icons/apps/outlook-mac.png"));
                    } else if (process.platform === "win32") {
                        let nimage = nativeImage.createFromPath(
                            join(__dirname, "../assets/icons/apps/outlook.png")
                        );
                        BrowserWindow.getAllWindows().forEach((window) => {
                            window.setOverlayIcon(nimage, "Outlook");
                        });
                    }
                } else if (
                    BrowserWindow.getFocusedWindow().webContents.getURL().includes("onedrive.live.com") ||
                    BrowserWindow.getFocusedWindow().webContents.getURL().includes("onedrive.aspx")
                ) {
                    if (process.platform === "darwin") {
                        app.dock.setIcon(join(__dirname, "../assets/icons/apps/onedrive-mac.png"));
                    } else if (process.platform === "win32") {
                        let nimage = nativeImage.createFromPath(
                            join(__dirname, "../assets/icons/apps/onedrive.png")
                        );
                        BrowserWindow.getAllWindows().forEach((window) => {
                            window.setOverlayIcon(nimage, "OneDrive");
                        });
                    }
                } else if (
                    BrowserWindow.getFocusedWindow().webContents.getURL().includes("teams.live.com")
                ) {
                    if (process.platform === "darwin") {
                        app.dock.setIcon(join(__dirname, "../assets/icons/apps/teams-mac.png"));
                    } else if (process.platform === "win32") {
                        let nimage = nativeImage.createFromPath(
                            join(__dirname, "../assets/icons/apps/teams.png")
                        );
                        BrowserWindow.getAllWindows().forEach((window) => {
                            window.setOverlayIcon(nimage, "Teams");
                        });
                    }
                } else if (
                    BrowserWindow.getFocusedWindow().webContents.getURL().includes("&ithint=onenote")
                ) {
                    if (process.platform === "darwin") {
                        app.dock.setIcon(join(__dirname, "../assets/icons/apps/onenote-mac.png"));
                    } else if (process.platform === "win32") {
                        let nimage = nativeImage.createFromPath(
                            join(__dirname, "../assets/icons/apps/onenote.png")
                        );
                        BrowserWindow.getAllWindows().forEach((window) => {
                            window.setOverlayIcon(nimage, "OneNote");
                        });
                    }
                } else {
                    if (process.platform === "darwin") {
                        app.dock.setIcon(null);
                    } else {
                        BrowserWindow.getAllWindows().forEach((window) => {
                            window.setOverlayIcon(null, "");
                        });
                    }
                }
            }
        }
        BrowserWindow.getAllWindows().forEach((window) => {
            if (window.webContents.getURL().includes("outlook.live.com")) {
                window.webContents
                    .executeJavaScript(
                        `
            const observer = new MutationObserver((mutationsList) => {
              let adElementFound = false;
              for (const mutation of mutationsList) {
                if (mutation.type === 'childList') {
                  const adElement = document.querySelector('div.GssDD');
                  if (adElement) {
                    adElement.remove();
                    adElementFound = true;
                  }
                }
              }
              if (adElementFound) {
                observer.disconnect();
              }
            });

            observer.observe(document.body, { childList: true, subtree: true });

            const adElement = document.querySelector('div.GssDD');
            if (adElement) {
              adElement.remove();
              observer.disconnect();
            }
            `
                    )
                    .catch();
            }
        });
        contents.insertCSS(
            `
      ::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }

      ::-webkit-scrollbar-track {
        background: transparent;
      }

      ::-webkit-scrollbar-thumb {
        background: transparent;
        border-radius: 5px;
      }

      ::-webkit-scrollbar-thumb:hover {
        background: #555;
      }      
      `
        );
    });
});

app.on("browser-window-created", (event, window) => {
    if (getValue("autohide-menubar") === "true") {
        window.setAutoHideMenuBar(true);
    } else {
        window.setAutoHideMenuBar(false);
    }
    window.webContents.on("did-finish-load", () => {
        if (getValue("discordrpcstatus") === "true") {
            setActivity(`On "${window.webContents.getTitle()}"`);
        }
    });
    if (getValue("blockadsandtrackers") === "true") {
        ElectronBlocker.fromPrebuiltAdsAndTracking(fetch).then((blocker) => {
            blocker.enableBlockingInSession(window.webContents.session);
        });
    }
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        } else {
            app.quit();
        }
    }
    if (process.platform === "darwin") {
        app.dock.hide();
    }
});
app.on('before-quit', () => {
    app.isQuitting = true;
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    } else {
        mainWindow.show();
    }
});
app.on('will-quit', () => {
    if (tray) {
        tray.destroy();
    }
});
app.on("ready", function () {
    checkInternetConnected().catch(() => {
        const options = {
            type: "warning",
            buttons: ["Ok"],
            defaultId: 2,
            title: "Warning",
            message: "You appear to be offline!",
            detail:
                "Please check your Internet Connectivity. This app cannot run without an Internet Connection!",
        };
        dialog.showMessageBox(null, options, (response) => {
            console.log(response);
        });
    });
    if (getValue("autoupdater") === "true") {
        autoUpdater.checkForUpdatesAndNotify();
    }
    if (getValue("discordrpcstatus") === "true") {
        loginToRPC();
        setActivity(`Opening Microsoft 365...`);
    }
});