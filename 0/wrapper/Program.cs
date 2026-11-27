using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace Замечательно;

internal static class Program
{
    public static string BaseDir = AppContext.BaseDirectory;

    public static string AppDir = Path.Combine(BaseDir, "app");

    public static string DataDir = Path.Combine(BaseDir, "data");

    // Один экземпляр на папку программы: при повторном запуске второе окно
    // не открывается, а уже работающее окно разворачивается и выходит вперёд.
    private static Mutex? _instanceMutex;

    private static EventWaitHandle? _showEvent;

    private static AppWindow? _mainWindow;

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool AllowSetForegroundWindow(int dwProcessId);

    // Журнал запуска и ошибок. Пишем в первое возможное место: data\log.txt,
    // затем log.txt рядом с программой, затем во временную папку. Раньше
    // обработчики ошибок писали только в data\log.txt: если папки data не было
    // (например, программу запустили в одиночку из архива), сам обработчик
    // падал, и приложение умирано молча, без окна и без следа.
    public static void Log(string what)
    {
        try
        {
            string[] candidates = new string[3]
            {
                Path.Combine(DataDir, "log.txt"),
                Path.Combine(BaseDir, "log.txt"),
                Path.Combine(Path.GetTempPath(), "Замечательно-log.txt")
            };
            string stamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
            string[] array = candidates;
            for (int i = 0; i < array.Length; i++)
            {
                try
                {
                    string directory = Path.GetDirectoryName(array[i]);
                    if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
                    {
                        Directory.CreateDirectory(directory);
                    }
                    File.AppendAllText(array[i], stamp + " " + what + Environment.NewLine);
                    return;
                }
                catch
                {
                }
            }
        }
        catch
        {
        }
    }

    /// <summary>
    /// Захватывает единственный экземпляр для этой папки программы. Если экземпляр
    /// уже работает — будит его окно и возвращает false (второй процесс выходит).
    /// </summary>
    private static bool ClaimSingleInstance()
    {
        // Имя зависит от папки программы: две разные копии в разных папках
        // могут работать одновременно, а повторный запуск одной копии — нет.
        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(
            BaseDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).ToLowerInvariant()));
        string id = Convert.ToHexString(hash, 0, 8);
        string mutexName = "Local\\Zamechatelno-" + id;
        string eventName = "Local\\Zamechatelno-show-" + id;

        Mutex mutex = new Mutex(true, mutexName, out bool createdNew);
        _instanceMutex = mutex;
        if (!createdNew)
        {
            // Мьютекс мог остаться от упавшего процесса: тогда он свободен,
            // и мы законно становимся первым экземпляром.
            bool acquired = false;
            try
            {
                acquired = mutex.WaitOne(0);
            }
            catch (AbandonedMutexException)
            {
                acquired = true;
            }
            if (!acquired)
            {
                // Разрешаем работающему окну выйти на передний план и просим
                // его показаться. Событие может ещё не успеть создаться —
                // поэтому несколько коротких попыток.
                AllowSetForegroundWindow(-1);
                for (int i = 0; i < 30; i++)
                {
                    try
                    {
                        using EventWaitHandle ev = EventWaitHandle.OpenExisting(eventName);
                        ev.Set();
                        break;
                    }
                    catch (WaitHandleCannotBeOpenedException)
                    {
                        Thread.Sleep(100);
                    }
                    catch
                    {
                        break;
                    }
                }
                return false;
            }
        }

        _showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, eventName);
        Thread watcher = new Thread((ThreadStart)delegate
        {
            while (true)
            {
                _showEvent.WaitOne();
                BringMainWindowToFront();
            }
        })
        {
            IsBackground = true,
            Name = "Zamechatelno-SingleInstance"
        };
        watcher.Start();
        return true;
    }

    private static void BringMainWindowToFront()
    {
        // Окно может ещё не успеть создаться — ждём его появления.
        for (int i = 0; i < 100; i++)
        {
            AppWindow? window = _mainWindow;
            if (window != null && window.IsHandleCreated)
            {
                try
                {
                    window.BeginInvoke(new Action(delegate
                    {
                        if (window.WindowState == FormWindowState.Minimized)
                        {
                            window.WindowState = FormWindowState.Normal;
                        }
                        window.Show();
                        window.Activate();
                        ShowWindow(window.Handle, 9); // SW_RESTORE
                        SetForegroundWindow(window.Handle);
                    }));
                }
                catch
                {
                }
                return;
            }
            Thread.Sleep(100);
        }
    }

    [STAThread]
    private static void Main(string[] args)
    {
        Environment.SetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "0xFF060607", EnvironmentVariableTarget.Process);
        Log("запуск " + typeof(Program).Assembly.GetName().Version?.ToString() + ", папка: " + BaseDir);
        if (!ClaimSingleInstance())
        {
            Log("повторный запуск: окно уже открыто, второй экземпляр закрыт");
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.ThreadException += delegate(object _, ThreadExceptionEventArgs e)
        {
            Log("thread: " + e.Exception);
        };
        AppDomain.CurrentDomain.UnhandledException += delegate(object _, UnhandledExceptionEventArgs e)
        {
            Log("unhandled: " + e.ExceptionObject);
        };
        try
        {
            _mainWindow = new AppWindow(new Vault(DataDir));
            Application.Run(_mainWindow);
        }
        catch (Exception ex)
        {
            // Любая ошибка при старте теперь показывается окном, а не гаснет молча.
            Log("fatal: " + ex);
            try
            {
                MessageBox.Show("«Замечательно» не смог запуститься.\n\n" + ex + "\n\nПодробности записаны в журнал: data\\log.txt; если папки data нет — log.txt рядом с программой; если и это недоступно — во временную папку (файл «Замечательно-log.txt»).", "Замечательно — ошибка запуска", MessageBoxButtons.OK, MessageBoxIcon.Hand);
            }
            catch
            {
            }
            Environment.Exit(1);
        }
        finally
        {
            try
            {
                _instanceMutex?.ReleaseMutex();
            }
            catch
            {
            }
        }
    }
}
