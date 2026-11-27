using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Замечательно;

public class AppWindow : Form
{
    private static readonly Color NotebookColor = Color.FromArgb(6, 6, 7);

    private readonly Vault _vault;

    private WebView2 _web;

    private Timer _snapshotTimer;

    private string _lastSnapshotJson = "";

    private string _lastPayloadJson = "";

    private bool _dirtySinceSnapshot;

    private readonly bool _backupOnExit;

    public AppWindow(Vault vault)
    {
        _vault = vault;
        _backupOnExit = File.Exists(Path.Combine(Program.DataDir, "exit-backup.on"));
        Text = "Замечательно";
        BackColor = NotebookColor;
        ClientSize = new Size(1280, 800);
        StartPosition = FormStartPosition.CenterScreen;
        // Иконка берётся из папки программы (как раньше, но без зависимости
        // от текущей папки процесса: если exe запустили не из его папки,
        // относительный путь "app.ico" раньше ронял старт ещё до показа окна).
        string iconPath = Path.Combine(Program.BaseDir, "app.ico");
        if (File.Exists(iconPath))
        {
            Icon = new Icon(iconPath);
        }
        FormBorderStyle = FormBorderStyle.None;
        MaximizedBounds = Screen.PrimaryScreen.WorkingArea;
        WindowState = FormWindowState.Maximized;
        _web = new WebView2
        {
            Dock = DockStyle.Fill,
            BackColor = NotebookColor,
            DefaultBackgroundColor = NotebookColor
        };
        Controls.Add(_web);
        Load += async delegate
        {
            try
            {
                await InitWeb();
            }
            catch (Exception ex)
            {
                // Например, если в системе нет WebView2 Runtime — раньше окно
                // оставалось пустым, а ошибка исчезала без следа.
                Program.Log("init: " + ex);
                MessageBox.Show(this, "Не удалось инициализировать WebView2." + Environment.NewLine + Environment.NewLine + ex.Message + Environment.NewLine + Environment.NewLine + "Обычно помогает установка Microsoft Edge WebView2 Runtime (evergreen). Подробности — в журнале data\\log.txt.", "Замечательно — ошибка WebView2", MessageBoxButtons.OK, MessageBoxIcon.Hand);
            }
        };
        // Интерфейс копит изменения и пишет их раз в минуту; при закрытии окна
        // он сам не успевал их отдать (beforeunload в WebView не срабатывает),
        // и всё последнее время до выхода терялось. Просим страницу досохранить
        // и ждём её сигнал «flushed»: ExecuteScriptAsync промисы НЕ ждёт, поэтому
        // сигнал страница шлёт сама, изнутри своей асинхронной функции.
        FormClosing += async delegate(object? _, FormClosingEventArgs e)
        {
            if (_flushed || e.CloseReason == CloseReason.WindowsShutDown)
            {
                FinishExit();
                return;
            }
            // повторное закрытие (Alt+F4, клик по панели задач) пока идёт
            // досохранение: отменяем и ждём, а не запускаем второй флаш —
            // раньше из-за гонки окно могло подвисать на несколько секунд
            if (_flushing)
            {
                e.Cancel = true;
                return;
            }
            e.Cancel = true;
            _flushing = true;
            try
            {
                await FlushWeb();
            }
            finally
            {
                _flushing = false;
            }
            _flushed = true;
            Close();
        };
    }

    private bool _flushed;

    private bool _flushing;

    private TaskCompletionSource<bool>? _flushTcs;

    private async Task FlushWeb()
    {
        try
        {
            if (_web.CoreWebView2 != null)
            {
                _flushTcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                await _web.ExecuteScriptAsync("(function(){try{if(window.__zameFlush)window.__zameFlush()}catch(e){}})()");
                // страница сначала рисует экран «СОХРАНЯЕТСЯ» (минимум ~0.7с),
                // потом пишет данные: у очень крупных листов сериализация
                // занимает секунды, поэтому запас — 10 секунд
                await Task.WhenAny(_flushTcs.Task, Task.Delay(10000));
            }
        }
        catch (Exception ex)
        {
            Program.Log("flush: " + ex.Message);
        }
    }

    private void FinishExit()
    {
        if (_dirtySinceSnapshot)
        {
            SaveSnapshot();
        }
        if (_backupOnExit)
        {
            CopyVaultToRezerv();
        }
    }

    // Безрамочное окно (FormBorderStyle.None): без этих стилей Windows считает,
    // что сворачивать окно нельзя, и клик по кнопке на панели задач только
    // активирует окно. WS_MINIMIZEBOX разрешает сворачивание (клик по кнопке
    // панели задач: свернуть → развернуть), WS_SYSMENU даёт кнопке на панели
    // задач обычное меню окна (свернуть, развернуть, закрыть).
    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.Style |= 0x00020000; // WS_MINIMIZEBOX
            cp.Style |= 0x00080000; // WS_SYSMENU
            return cp;
        }
    }

    private async Task InitWeb()
    {
        string fixedRuntime = Path.Combine(Program.BaseDir, "WebView2Runtime");
        CoreWebView2EnvironmentOptions options = (Directory.Exists(fixedRuntime) ? new CoreWebView2EnvironmentOptions() : null);
        CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(Directory.Exists(fixedRuntime) ? fixedRuntime : null, Path.Combine(Program.BaseDir, "runtime-data"), options);
        await _web.EnsureCoreWebView2Async(environment);
        _web.DefaultBackgroundColor = NotebookColor;
        CoreWebView2 coreWebView = _web.CoreWebView2;
        coreWebView.SetVirtualHostNameToFolderMapping("app.local", Program.AppDir, CoreWebView2HostResourceAccessKind.Allow);
        coreWebView.NewWindowRequested += delegate(object? _, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
        };
        coreWebView.NavigationStarting += delegate(object? _, CoreWebView2NavigationStartingEventArgs e)
        {
            if (new Uri(e.Uri).Host != "app.local")
            {
                e.Cancel = true;
            }
        };
        coreWebView.DownloadStarting += delegate(object? _, CoreWebView2DownloadStartingEventArgs e)
        {
            string exportsDir = Path.Combine(Program.DataDir, "exports");
            Directory.CreateDirectory(exportsDir);
            string fileName = Path.GetFileName(new Uri(e.ResultFilePath).LocalPath);
            e.ResultFilePath = Path.Combine(exportsDir, string.IsNullOrWhiteSpace(fileName) ? "выгрузка.json" : fileName);
        };
        coreWebView.WebMessageReceived += OnWebMessage;
        coreWebView.Settings.AreDefaultContextMenusEnabled = false;
        coreWebView.Settings.IsZoomControlEnabled = false;
        coreWebView.Settings.AreBrowserAcceleratorKeysEnabled = false;
        try
        {
            await coreWebView.Profile.ClearBrowsingDataAsync();
        }
        catch
        {
        }
        _web.Source = new Uri("https://app.local/index.html");
        _snapshotTimer = new Timer
        {
            Interval = 30000
        };
        _snapshotTimer.Tick += delegate
        {
            SaveSnapshot();
        };
        _snapshotTimer.Start();
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string payload = "";
        string id;
        string op;
        try
        {
            using JsonDocument jsonDocument = JsonDocument.Parse(e.WebMessageAsJson);
            id = jsonDocument.RootElement.GetProperty("id").GetInt32().ToString();
            op = jsonDocument.RootElement.GetProperty("op").GetString() ?? "";
            if (jsonDocument.RootElement.TryGetProperty("payload", out var value) && value.ValueKind == JsonValueKind.String)
            {
                payload = value.GetString() ?? "";
            }
        }
        catch
        {
            return;
        }
        try
        {
            switch (op)
            {
            case "load":
            {
                if (!_vault.Exists)
                {
                    Reply(id, ok: false, "new");
                    break;
                }
                if (!_vault.Unlocked)
                {
                    Reply(id, ok: false, "locked");
                    break;
                }
                string data = Encoding.UTF8.GetString(_vault.ReadRaw());
                Reply(id, ok: true, data);
                break;
            }
            case "unlock":
                try
                {
                    _vault.LoadKeyFromFile(payload);
                    _vault.ReadRaw();
                    Reply(id, ok: true, "unlocked");
                    break;
                }
                catch
                {
                    Reply(id, ok: false, "bad");
                    break;
                }
            case "create":
                try
                {
                    if (payload.Length < 4)
                    {
                        Reply(id, ok: false, "short");
                        break;
                    }
                    _vault.CreateKey(payload);
                    _vault.WriteRaw("{}");
                    Reply(id, ok: true, "created");
                    break;
                }
                catch
                {
                    Reply(id, ok: false, "fail");
                    break;
                }
            case "save":
                if (!_vault.Unlocked)
                {
                    Reply(id, ok: true, "");
                    break;
                }
                if (!string.IsNullOrEmpty(payload))
                {
                    _vault.WriteRaw(payload);
                    // запоминаем последний записанный JSON: снапшот и резервная
                    // копия делаются из него БЕЗ расшифровки хранилища — раньше
                    // каждые 30 секунд (и на выходе) весь файл расшифровывался
                    // заново, что на больших листах подвешивало окно
                    _lastPayloadJson = payload;
                    _dirtySinceSnapshot = true;
                }
                Reply(id, ok: true, "");
                break;
            case "backupNow":
            {
                // резервная копия по кнопке «РЕЗЕРВИРОВАНИЕ» — не дожидаясь выхода
                string? copied = CopyVaultToRezerv();
                if (copied != null) Reply(id, ok: true, copied);
                else Reply(id, ok: false, "Хранилище ещё не создано");
                break;
            }
            case "send":
            {
                string exportsDir = Path.Combine(Program.DataDir, "exports");
                Directory.CreateDirectory(exportsDir);
                JsonDocument jsonDocument2 = JsonDocument.Parse(payload);
                string name = jsonDocument2.RootElement.GetProperty("name").GetString() ?? "статья.html";
                File.WriteAllText(contents: jsonDocument2.RootElement.GetProperty("content").GetString() ?? "", path: Path.Combine(exportsDir, name), encoding: new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
                Reply(id, ok: true, name);
                break;
            }
            case "backupOnExit":
            {
                if (payload == "get")
                {
                    Reply(id, ok: true, File.Exists(Path.Combine(Program.DataDir, "exit-backup.on")) ? "1" : "0");
                    break;
                }
                string flagPath = Path.Combine(Program.DataDir, "exit-backup.on");
                if (payload == "1")
                {
                    File.WriteAllText(flagPath, "1");
                }
                else if (File.Exists(flagPath))
                {
                    File.Delete(flagPath);
                }
                Reply(id, ok: true, "");
                break;
            }
            case "flushed":
                // страница досохраннила данные при выходе — можно закрываться
                _flushTcs?.TrySetResult(true);
                break;
            case "close":
                BeginInvoke(Close);
                Reply(id, ok: true, "");
                break;
            case "export":
            {
                string exportsDir = Path.Combine(Program.DataDir, "exports");
                Directory.CreateDirectory(exportsDir);
                string fileName = $"замечательно-{DateTime.Now:yyyyMMdd-HHmmss}.json";
                File.WriteAllText(Path.Combine(exportsDir, fileName), payload, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
                Reply(id, ok: true, fileName);
                break;
            }
            default:
                Reply(id, ok: false, "Неизвестная операция");
                break;
            }
        }
        catch (Exception ex)
        {
            Reply(id, ok: false, ex.Message);
        }
    }

    /// <summary>
    /// Резервная копия данных в папку rezerv рядом с программой (на всякий случай).
    /// Копируется сам файл хранилища (в нём все листы и настройки): обновляем
    /// «свежую» копию и пишем штампованную по времени, старые штампованные
    /// чистим (оставляем 10). Это копирование одного файла — мгновенно; раньше
    /// на выходе целиком копировалась папка data вместе с backups (до 60
    /// снапшотов), что и давало многосекундное зависание при выходе.
    /// Возвращает путь свежей копии или null, если копировать нечего.
    /// </summary>
    private string? CopyVaultToRezerv()
    {
        try
        {
            if (!_vault.Exists) return null;
            string rezervDir = Path.Combine(Program.BaseDir, "rezerv");
            Directory.CreateDirectory(rezervDir);
            string latestPath = Path.Combine(rezervDir, "замечательно-копия.vault");
            File.Copy(_vault.VaultPath, latestPath, overwrite: true);
            string stamped = Path.Combine(rezervDir, $"замечательно-{DateTime.Now:yyyyMMdd-HHmmss}.vault");
            if (!File.Exists(stamped))
            {
                File.Copy(_vault.VaultPath, stamped);
            }
            FileInfo[] stampedFiles = new DirectoryInfo(rezervDir).GetFiles("замечательно-20*.vault").OrderByDescending(File.GetLastWriteTime).ToArray();
            for (int i = 10; i < stampedFiles.Length; i++)
            {
                try
                {
                    stampedFiles[i].Delete();
                }
                catch
                {
                }
            }
            return latestPath;
        }
        catch (Exception ex)
        {
            Program.Log("rezerv: " + ex.Message);
            return null;
        }
    }

    private void SaveSnapshot()
    {
        try
        {
            // сравниваем с последним ПРИНЯТЫМ от страницы JSON: расшифровывать
            // хранилище ради сравнения больше не нужно
            string current = _lastPayloadJson;
            if (_dirtySinceSnapshot && current.Length != 0 && current != _lastSnapshotJson && current != "{}")
            {
                _lastSnapshotJson = current;
                _vault.Snapshot(current);
            }
        }
        catch
        {
        }
        _dirtySinceSnapshot = false;
    }

    private void Reply(string id, bool ok, string data)
    {
        string webMessageAsJson = JsonSerializer.Serialize(new
        {
            id = int.Parse(id),
            ok = ok,
            data = data
        });
        _web.CoreWebView2.PostWebMessageAsJson(webMessageAsJson);
    }
}
