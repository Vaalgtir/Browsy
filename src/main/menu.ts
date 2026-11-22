import { Menu, app } from 'electron'
import type { Browser } from './Browser'

/** Menu de l'application et raccourcis clavier, repris d'Arc. */
export function buildMenu(browser: Browser): void {
  const active = () => browser.activeWebContents()
  const zoom = (delta: number) => {
    const wc = active()
    if (wc) wc.setZoomLevel(delta === 0 ? 0 : wc.getZoomLevel() + delta)
  }
  const numbered = (prefix: string, label: (n: number) => string, run: (n: number) => void) =>
    Array.from({ length: 9 }, (_, i) => ({ label: label(i + 1), accelerator: `${prefix}+${i + 1}`, click: () => run(i + 1) }))

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about', label: `À propos de ${app.name}` },
          { type: 'separator' },
          {
            label: 'Définir comme navigateur par défaut',
            type: 'checkbox',
            checked: app.isDefaultProtocolClient('https'),
            enabled: app.isPackaged,
            click: (item) => {
              // macOS demande confirmation à l'utilisateur.
              app.setAsDefaultProtocolClient('http')
              app.setAsDefaultProtocolClient('https')
              item.checked = app.isDefaultProtocolClient('https')
            },
          },
          { type: 'separator' },
          { role: 'services', label: 'Services' },
          { type: 'separator' },
          { role: 'hide', label: `Masquer ${app.name}` },
          { role: 'hideOthers', label: 'Masquer les autres' },
          { role: 'unhide', label: 'Tout afficher' },
          { type: 'separator' },
          { role: 'quit', label: `Quitter ${app.name}` },
        ],
      },
      {
        label: 'Fichier',
        submenu: [
          { label: 'Nouvel onglet', accelerator: 'CmdOrCtrl+T', click: () => browser.openCommandBar('new-tab') },
          { label: "Modifier l'URL", accelerator: 'CmdOrCtrl+L', click: () => browser.openCommandBar('edit-url') },
          { label: "Rouvrir l'onglet fermé", accelerator: 'CmdOrCtrl+Shift+T', click: () => void browser.reopenClosedTab() },
          { type: 'separator' },
          {
            label: "Fermer l'onglet",
            accelerator: 'CmdOrCtrl+W',
            click: () => {
              const id = browser.activeTabId
              if (id) browser.closeTab(id)
            },
          },
          { type: 'separator' },
          { label: 'Imprimer…', accelerator: 'CmdOrCtrl+P', click: () => active()?.print() },
        ],
      },
      {
        label: 'Édition',
        submenu: [
          { role: 'undo', label: 'Annuler' },
          { role: 'redo', label: 'Rétablir' },
          { type: 'separator' },
          { role: 'cut', label: 'Couper' },
          { role: 'copy', label: 'Copier' },
          { role: 'paste', label: 'Coller' },
          { role: 'pasteAndMatchStyle', label: 'Coller sans mise en forme' },
          { role: 'selectAll', label: 'Tout sélectionner' },
          { type: 'separator' },
          { label: "Copier l'URL", accelerator: 'CmdOrCtrl+Shift+C', click: () => browser.copyActiveUrl() },
          { label: 'Rechercher dans la page', accelerator: 'CmdOrCtrl+F', click: () => browser.openFind() },
        ],
      },
      {
        label: 'Présentation',
        submenu: [
          { label: 'Afficher/masquer la sidebar', accelerator: 'CmdOrCtrl+S', click: () => browser.toggleSidebar() },
          { type: 'separator' },
          { label: 'Recharger', accelerator: 'CmdOrCtrl+R', click: () => active()?.reload() },
          { label: 'Recharger sans cache', accelerator: 'CmdOrCtrl+Shift+R', click: () => active()?.reloadIgnoringCache() },
          { type: 'separator' },
          { label: 'Outils de développement', accelerator: 'Alt+CmdOrCtrl+I', click: () => active()?.toggleDevTools() },
          { label: 'Code source', accelerator: 'Alt+CmdOrCtrl+U', click: () => { const url = active()?.getURL(); if (url) void browser.newTab(`view-source:${url}`) } },
          { label: "DevTools de l'interface Browsy", accelerator: 'Alt+Shift+CmdOrCtrl+I', click: () => browser.win.webContents.toggleDevTools() },
          { type: 'separator' },
          { label: 'Zoom avant', accelerator: 'CmdOrCtrl+Plus', click: () => zoom(0.5) },
          { label: 'Zoom avant', accelerator: 'CmdOrCtrl+=', visible: false, click: () => zoom(0.5) },
          { label: 'Zoom arrière', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.5) },
          { label: 'Taille réelle', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
          { type: 'separator' },
          { role: 'togglefullscreen', label: 'Plein écran' },
        ],
      },
      {
        label: 'Historique',
        submenu: [
          { label: 'Précédent', accelerator: 'CmdOrCtrl+[', click: () => active()?.navigationHistory.goBack() },
          { label: 'Suivant', accelerator: 'CmdOrCtrl+]', click: () => active()?.navigationHistory.goForward() },
          { label: 'Précédent', accelerator: 'CmdOrCtrl+Left', visible: false, click: () => active()?.navigationHistory.goBack() },
          { label: 'Suivant', accelerator: 'CmdOrCtrl+Right', visible: false, click: () => active()?.navigationHistory.goForward() },
        ],
      },
      {
        label: 'Onglets',
        submenu: [
          { label: 'Épingler / désépingler', accelerator: 'CmdOrCtrl+D', click: () => browser.togglePinActive() },
          { type: 'separator' },
          { label: 'Onglet suivant', accelerator: 'Ctrl+Tab', click: () => browser.selectRelativeTab(1) },
          { label: 'Onglet précédent', accelerator: 'Ctrl+Shift+Tab', click: () => browser.selectRelativeTab(-1) },
          { label: 'Onglet suivant', accelerator: 'Alt+CmdOrCtrl+Down', visible: false, click: () => browser.selectRelativeTab(1) },
          { label: 'Onglet précédent', accelerator: 'Alt+CmdOrCtrl+Up', visible: false, click: () => browser.selectRelativeTab(-1) },
          { type: 'separator' },
          ...numbered('CmdOrCtrl', (n) => (n === 9 ? 'Dernier onglet' : `Onglet ${n}`), (n) => browser.selectTabAt(n)),
        ],
      },
      {
        label: 'Spaces',
        submenu: [
          { label: 'Space suivant', accelerator: 'Alt+CmdOrCtrl+Right', click: () => browser.selectRelativeSpace(1) },
          { label: 'Space précédent', accelerator: 'Alt+CmdOrCtrl+Left', click: () => browser.selectRelativeSpace(-1) },
          { type: 'separator' },
          ...numbered('Ctrl', (n) => `Space ${n}`, (n) => browser.selectSpaceAt(n)),
        ],
      },
      { role: 'windowMenu', label: 'Fenêtre' },
    ]),
  )
}
