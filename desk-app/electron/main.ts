import { app, BrowserWindow, Tray, Menu, ipcMain, screen, session } from 'electron'
import path from 'path'
import fs from 'fs'
import AutoLaunch from 'auto-launch'
import { execSync, exec } from 'child_process'
import crypto from 'crypto'
import loudness from 'loudness'
// __dirname and __filename are available as globals in CommonJS

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let breakTimer: NodeJS.Timeout | null = null
let timeRemaining = 1800 * 1000  // 30 minutes in milliseconds
let initialTime = 1800 * 1000    // 30 minutes in milliseconds
let breakDuration = 90           // 90 seconds (1 minute 30 seconds)
let autoStart = true  // Start timer by default
let isPaused = false
let isMinimized = false
let isQuitting = false
let settingsReceived = false  // Track if we've received settings from backend

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json')

const isDev = process.env.NODE_ENV === 'development'

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
      if (config.breakInterval) {
        initialTime = config.breakInterval * 1000  // Convert seconds to milliseconds
        timeRemaining = initialTime
      }
      if (config.breakDuration) breakDuration = config.breakDuration
      if (config.autoStart !== undefined) autoStart = config.autoStart
    }
  } catch (err) {
    console.error('Failed to load config:', err)
  }
}

function saveConfig() {
  try {
    const config = {
      breakInterval: initialTime / 1000,  // Convert milliseconds to seconds
      breakDuration: breakDuration,
      autoStart: autoStart,
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
  } catch (err) {
    console.error('Failed to save config:', err)
  }
}

loadConfig()

function getMachineId(): string {
  try {
    let machineId = ''
    
    if (process.platform === 'win32') {
      // Windows: Get machine GUID from registry
      machineId = execSync(
        'powershell -command "(Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Cryptography).MachineGuid"',
        { encoding: 'utf8' }
      ).trim()
    } else if (process.platform === 'darwin') {
      // macOS: Get hardware UUID
      machineId = execSync('ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID', 
        { encoding: 'utf8' }
      ).split('"')[3]
    } else {
      // Linux: Get machine ID
      machineId = execSync('cat /var/lib/dbus/machine-id', { encoding: 'utf8' }).trim()
    }
    
    // Hash it for privacy
    return crypto.createHash('sha256').update(machineId).digest('hex').substring(0, 32)
  } catch (error) {
    console.error('Failed to get machine ID:', error)
    // Fallback to a stored UUID
    const configPath = path.join(app.getPath('userData'), 'machine-id.json')
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8')).machineId
    }
    const fallbackId = crypto.randomUUID()
    fs.writeFileSync(configPath, JSON.stringify({ machineId: fallbackId }))
    return fallbackId
  }
}

const autoLauncher = new AutoLaunch({
  name: 'AntiBurnout',
  isHidden: true,
})

autoLauncher.enable().catch((err: unknown) => {
  console.error('Auto-launch failed:', err)
})

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

function createWindow() {
  const iconPath = path.join(__dirname, '../public/icon.png')

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    resizable: true,
    frame: false,
    title: 'AntiBurnout',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.setIcon(iconPath)
  mainWindow.setMenuBarVisibility(false)

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize()
    mainWindow?.show()
    
    mainWindow?.webContents.send('settings-updated', {
      interval: initialTime / 1000,  // Convert ms to seconds
      duration: breakDuration
    })
  })

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
      isMinimized = true
      return false
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function quitApp() {
  isQuitting = true
  saveConfig()
  
  if (breakTimer) {
    clearInterval(breakTimer)
    breakTimer = null
  }
  
  if (mainWindow) {
    mainWindow.removeAllListeners('close')
    mainWindow.destroy()
    mainWindow = null
  }
  
  if (tray) {
    tray.destroy()
    tray = null
  }
  
  app.quit()
}

function createTray() {
  const iconPath = path.join(__dirname, '../public/icon.png')
  
  if (!fs.existsSync(iconPath)) {
    console.error('Icon file not found at:', iconPath)
    return
  }
  
  tray = new Tray(iconPath)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open AntiBurnout',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
        }
      },
    },
    {
      label: 'Reset Timer',
      click: () => {
        resetTimer()
      },
    },
    {
      type: 'separator',
    },
    {
      label: 'Exit',
      click: () => {
        quitApp()
      },
    },
  ])

  tray.setToolTip('AntiBurnout - Next break in ' + formatTime(timeRemaining))
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show()
    }
  })
}

function startBreakTimer() {
  if (breakTimer) {
    clearInterval(breakTimer)
  }

  console.log('Starting timer with initialTime:', initialTime)

  breakTimer = setInterval(() => {
    if (!isPaused) {
      timeRemaining -= 1000

      if (tray) {
        tray.setToolTip('AntiBurnout - Next break in ' + formatTime(timeRemaining))
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('timer-update', timeRemaining)
      }

      if (timeRemaining <= 0) {
        if (breakTimer) {
          clearInterval(breakTimer)
          breakTimer = null
        }
        openBreakWindow()
      }
    }
  }, 1000)
}

function openBreakWindow() {
  if (mainWindow) {
    if (isMinimized) {
      mainWindow.show()
      isMinimized = false
    }
    mainWindow.focus()
    mainWindow.webContents.send('break-time', {
      message: 'Time to rest your eyes!',
      instruction: 'Look at something 20 feet away for 20 seconds',
      duration: breakDuration,
    })
  }
}

function resetTimer() {
  timeRemaining = initialTime
  isPaused = false
  startBreakTimer()
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('timer-reset')
  }
  
  if (tray) {
    tray.setToolTip(`AntiBurnout - Timer reset! Next break in ${Math.round(initialTime / 60000)}:00`)
  }
}

// IPC handlers
ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

ipcMain.on('pause-timer', () => {
  isPaused = true
})

ipcMain.on('resume-timer', () => {
  isPaused = false
})

ipcMain.on('reset-timer', () => {
  resetTimer()
})

ipcMain.on('timer-break-complete', () => {
  timeRemaining = initialTime
  startBreakTimer()
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('timer-reset')
  }
})

ipcMain.on('update-timer-setting', (event, { interval, duration, autoStart: newAutoStart }) => {
  console.log('Updating settings:', { interval, duration, autoStart: newAutoStart })
  initialTime = interval * 1000  // Convert seconds to milliseconds
  timeRemaining = initialTime
  breakDuration = duration
  if (newAutoStart !== undefined) autoStart = newAutoStart
  saveConfig()
  
  // Mark that we've received settings from backend
  settingsReceived = true
  
  // Start or restart the timer with new settings
  startBreakTimer()
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings-updated', { interval, duration, autoStart })
  }
})

ipcMain.on('minimize-to-tray', () => {
  console.log('Minimize to tray called')
  if (mainWindow) {
    mainWindow.hide()
    isMinimized = true
    console.log('Window hidden, isMinimized:', isMinimized)
  }
})

ipcMain.on('quit-app', () => {
  quitApp()
})

ipcMain.handle('get-machine-id', () => {
  return getMachineId()
})

// Get system brightness (Windows)
ipcMain.handle('get-system-brightness', async () => {
  try {
    if (process.platform === 'win32') {
      console.log('Detecting system brightness...')
      const output = execSync(
        'powershell -command "(Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightness).CurrentBrightness"',
        { encoding: 'utf8', timeout: 5000 }
      ).trim()
      
      const brightness = parseInt(output)
      if (!isNaN(brightness) && brightness >= 0 && brightness <= 100) {
        console.log('Brightness detected:', brightness)
        return brightness
      }
      console.log('Invalid brightness value:', output)
      return null
    }
    return null
  } catch (error) {
    console.error('Failed to get brightness:', error)
    return null
  }
})

// Get system volume (Windows)
ipcMain.handle('get-system-volume', async () => {
  try {
    console.log('Detecting system volume...')
    const volume = await loudness.getVolume()
    console.log('Volume detected:', volume)
    return volume
  } catch (error) {
    console.error('Failed to get volume:', error)
    return null
  }
})



// Set system brightness (Windows)
ipcMain.handle('set-system-brightness', async (event, brightness: number) => {
  try {
    if (process.platform === 'win32') {
      console.log('Setting brightness to:', brightness)
      
      try {
        execSync(
          `powershell -command "$b = ${brightness}; $m = Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightnessMethods -ErrorAction Stop; $m.WmiSetBrightness(0, $b)"`,
          { encoding: 'utf8', timeout: 5000 }
        )
        console.log('Brightness set via WMI')
        return { success: true, brightness }
      } catch (wmiError) {
        console.log('WMI brightness not available, trying PowerShell display brightness...')
      }

      try {
        execSync(
          `powershell -command "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class Display{[DllImport(\"dxva2.dll\", SetLastError=true)]public static extern bool SetMonitorBrightness(IntPtr hMonitor,uint dwBrightness);[DllImport(\"dxva2.dll\")]public static extern IntPtr GetMonitorFromWindow(IntPtr hWnd,uint dwFlags);}' -ErrorAction Stop"`,
          { encoding: 'utf8', timeout: 5000 }
        )
      } catch {
        console.log('No brightness control available on this system')
      }

      return { success: false, error: 'Brightness control not supported on this display' }
    }
    return { success: false, error: 'Not supported on this platform' }
  } catch (error) {
    console.error('Failed to set brightness:', error)
    return { success: false, error: String(error) }
  }
})

// Set system volume (Windows)
ipcMain.handle('set-system-volume', async (event, volume: number) => {
  try {
    console.log('Setting volume to:', volume)
    await loudness.setVolume(volume)
    console.log('Volume set successfully')
    return { success: true, volume }
  } catch (error) {
    console.error('Failed to set volume:', error)
    return { success: false, error: String(error) }
  }
})



app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') callback(true)
    else callback(false)
  })

  createWindow()
  createTray()
  
  // Don't start timer yet - wait for settings from backend
  // Timer will start when frontend sends settings after login

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  saveConfig()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
