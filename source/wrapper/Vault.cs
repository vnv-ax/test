using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Замечательно;

public sealed class Vault
{
	private const int SaltSize = 16;

	private const int NonceSize = 12;

	private const int TagSize = 16;

	private const int Iterations = 210000;

	private static readonly byte[] Magic = "ZMKLT1"u8.ToArray();

	private readonly string _dataDir;

	private readonly string _vaultPath;

	private readonly string _backupsDir;

	private readonly string _mirrorDir;

	private byte[] _key;

	public byte[] Salt { get; private set; }

	public string VaultPath => _vaultPath;

	public bool Exists => File.Exists(_vaultPath);

	public bool Unlocked => _key != null;

	public Vault(string dataDir)
	{
		_dataDir = dataDir;
		Directory.CreateDirectory(dataDir);
		_vaultPath = Path.Combine(dataDir, "замечательно.vault");
		_backupsDir = Path.Combine(dataDir, "backups");
		_mirrorDir = Path.Combine(dataDir, "mirror");
		Directory.CreateDirectory(_backupsDir);
		Directory.CreateDirectory(_mirrorDir);
	}

	public void CreateKey(string password)
	{
		Salt = RandomNumberGenerator.GetBytes(16);
		_key = Rfc2898DeriveBytes.Pbkdf2(password, Salt, 210000, HashAlgorithmName.SHA256, 32);
	}

	public void LoadKey(string password, byte[] salt)
	{
		Salt = salt;
		_key = Rfc2898DeriveBytes.Pbkdf2(password, Salt, 210000, HashAlgorithmName.SHA256, 32);
	}

	public byte[] ReadRaw()
	{
		byte[] blob = File.ReadAllBytes(_vaultPath);
		return Decrypt(blob);
	}

	public void LoadKeyFromFile(string password)
	{
		byte[] array = File.ReadAllBytes(_vaultPath);
		if (array.Length < Magic.Length + 16 || !array.AsSpan(0, Magic.Length).SequenceEqual(Magic))
		{
			throw new InvalidDataException("Файл хранилища повреждён.");
		}
		byte[] array2 = new byte[16];
		Array.Copy(array, Magic.Length, array2, 0, 16);
		LoadKey(password, array2);
	}

	public void WriteRaw(string json)
	{
		byte[] bytes = Encrypt(Encoding.UTF8.GetBytes(json));
		AtomicWrite(_vaultPath, bytes);
		AtomicWrite(Path.Combine(_backupsDir, "latest.vault"), bytes);
		AtomicWrite(Path.Combine(_mirrorDir, "замечательно.vault"), bytes);
	}

	public byte[] ReadBackup(string path)
	{
		return Decrypt(File.ReadAllBytes(path));
	}

	public string[] ListBackups()
	{
		return Directory.GetFiles(_backupsDir, "*.vault").OrderByDescending(File.GetLastWriteTime).ToArray();
	}

	public void Snapshot(string json)
	{
		byte[] bytes = Encrypt(Encoding.UTF8.GetBytes(json));
		string path = $"замечательно-{DateTime.Now:yyyyMMdd-HHmmss}.vault";
		AtomicWrite(Path.Combine(_backupsDir, path), bytes);
		string[] array = Directory.GetFiles(_backupsDir, "замечательно-*.vault").OrderByDescending(File.GetLastWriteTime).ToArray();
		for (int i = 60; i < array.Length; i++)
		{
			File.Delete(array[i]);
		}
	}

	private byte[] Encrypt(byte[] plain)
	{
		byte[] bytes = RandomNumberGenerator.GetBytes(12);
		byte[] array = new byte[plain.Length];
		byte[] array2 = new byte[16];
		using AesGcm aesGcm = new AesGcm(_key, 16);
		aesGcm.Encrypt(bytes, plain, array, array2);
		using MemoryStream memoryStream = new MemoryStream();
		memoryStream.Write(Magic);
		memoryStream.Write(Salt);
		memoryStream.Write(bytes);
		memoryStream.Write(array2);
		memoryStream.Write(array);
		return memoryStream.ToArray();
	}

	private byte[] Decrypt(byte[] blob)
	{
		int num = Magic.Length + 16 + 12 + 16;
		if (blob.Length < num || !blob.AsSpan(0, Magic.Length).SequenceEqual(Magic))
		{
			throw new InvalidDataException("Файл хранилища повреждён или это не наш файл.");
		}
		byte[] array = new byte[16];
		Array.Copy(blob, Magic.Length, array, 0, 16);
		if (!array.AsSpan().SequenceEqual(Salt))
		{
			throw new InvalidDataException("Соль не совпадает.");
		}
		byte[] array2 = new byte[12];
		Array.Copy(blob, Magic.Length + 16, array2, 0, 12);
		byte[] array3 = new byte[16];
		Array.Copy(blob, Magic.Length + 16 + 12, array3, 0, 16);
		byte[] array4 = new byte[blob.Length - num];
		Array.Copy(blob, num, array4, 0, array4.Length);
		byte[] array5 = new byte[array4.Length];
		using AesGcm aesGcm = new AesGcm(_key, 16);
		aesGcm.Decrypt(array2, array4, array3, array5);
		return array5;
	}

	private static void AtomicWrite(string path, byte[] bytes)
	{
		string text = path + ".tmp";
		File.WriteAllBytes(text, bytes);
		if (File.Exists(path))
		{
			File.Replace(text, path, null);
		}
		else
		{
			File.Move(text, path);
		}
	}
}
