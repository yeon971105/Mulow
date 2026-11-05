"""One exact current-user Windows credential. Import never accesses the vault."""
import ctypes
from ctypes import wintypes
import hmac
import sys

TARGET = 'Mulow/Baseten/MuseSpark/Local-v1'
ACCOUNT = 'Mulow Muse Spark API key'
MAX_KEY_BYTES = 1000


class CredentialError(Exception):
    pass


def validate_secret(value):
    if not isinstance(value, bytearray) or not 16 <= len(value) <= MAX_KEY_BYTES or any(c < 33 or c > 126 for c in value):
        raise CredentialError('Invalid API key. Nothing was sent.')
    return value


def wipe(value):
    if isinstance(value, bytearray):
        value[:] = b'\0' * len(value)


class CREDENTIALW(ctypes.Structure):
    _fields_ = [('Flags', wintypes.DWORD), ('Type', wintypes.DWORD),
                ('TargetName', wintypes.LPWSTR), ('Comment', wintypes.LPWSTR),
                ('LastWritten', wintypes.FILETIME), ('CredentialBlobSize', wintypes.DWORD),
                ('CredentialBlob', ctypes.POINTER(wintypes.BYTE)), ('Persist', wintypes.DWORD),
                ('AttributeCount', wintypes.DWORD), ('Attributes', ctypes.c_void_p),
                ('TargetAlias', wintypes.LPWSTR), ('UserName', wintypes.LPWSTR)]


class CREDUI_INFO(ctypes.Structure):
    _fields_ = [('cbSize', wintypes.DWORD), ('hwndParent', wintypes.HWND),
                ('pszMessageText', wintypes.LPCWSTR), ('pszCaptionText', wintypes.LPCWSTR),
                ('hbmBanner', wintypes.HBITMAP)]


class WindowsVault:
    """No enumerate, wildcard, export, delete, rotation, or cross-user operation."""
    def __init__(self):
        if sys.platform != 'win32':
            raise CredentialError('Windows Credential Manager requires Windows.')
        self.api = ctypes.WinDLL('advapi32.dll', use_last_error=True, winmode=0x800)
        self.api.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.POINTER(CREDENTIALW))]
        self.api.CredReadW.restype = wintypes.BOOL
        self.api.CredWriteW.argtypes = [ctypes.POINTER(CREDENTIALW), wintypes.DWORD]
        self.api.CredWriteW.restype = wintypes.BOOL
        self.api.CredFree.argtypes = [ctypes.c_void_p]
        self.api.CredFree.restype = None

    def _read(self, *, existence_only=False):
        pointer = ctypes.POINTER(CREDENTIALW)()
        if not self.api.CredReadW(TARGET, 1, 0, ctypes.byref(pointer)):
            if ctypes.get_last_error() == 1168:
                if existence_only:
                    return False
                raise CredentialError('The exact Mulow key is missing. Run secure setup once.')
            raise CredentialError('The exact Mulow credential could not be read.')
        try:
            item = pointer.contents
            if item.Type != 1 or item.TargetName != TARGET or item.Persist != 2 or item.UserName != ACCOUNT:
                raise CredentialError('The exact Mulow credential has unexpected metadata.')
            if existence_only:
                return True
            if not item.CredentialBlob or not 16 <= item.CredentialBlobSize <= MAX_KEY_BYTES:
                raise CredentialError('The exact Mulow credential has an invalid size.')
            result = bytearray(item.CredentialBlobSize)
            destination = (ctypes.c_ubyte * len(result)).from_buffer(result)
            ctypes.memmove(destination, item.CredentialBlob, len(result))
            try:
                return validate_secret(result)
            except Exception:
                wipe(result)
                raise
        finally:
            if pointer:
                item = pointer.contents
                if item.CredentialBlob and item.CredentialBlobSize <= MAX_KEY_BYTES:
                    ctypes.memset(item.CredentialBlob, 0, item.CredentialBlobSize)
                self.api.CredFree(pointer)

    def exists(self):
        return self._read(existence_only=True)

    def read(self):
        return self._read()

    def create(self, secret):
        validate_secret(secret)
        if self.exists():
            raise CredentialError('The exact Mulow key already exists; it was not overwritten.')
        blob = (wintypes.BYTE * len(secret)).from_buffer(secret)
        item = CREDENTIALW(Type=1, TargetName=TARGET, Comment='Mulow only; Baseten Muse Spark; this Windows user and PC',
                           CredentialBlobSize=len(secret), CredentialBlob=blob, Persist=2, UserName=ACCOUNT)
        if not self.api.CredWriteW(ctypes.byref(item), 0):
            raise CredentialError('Windows did not confirm saving the Mulow key.')


def prompt_native_secret():
    """Masked local Win32 generic-credential prompt; never Windows account auth."""
    if sys.platform != 'win32':
        raise CredentialError('Secure setup requires Windows.')
    api = ctypes.WinDLL('credui.dll', use_last_error=True, winmode=0x800)
    api.CredUIPromptForCredentialsW.argtypes = [ctypes.POINTER(CREDUI_INFO), wintypes.LPCWSTR, ctypes.c_void_p,
        wintypes.DWORD, wintypes.LPWSTR, wintypes.ULONG, wintypes.LPWSTR, wintypes.ULONG,
        ctypes.POINTER(wintypes.BOOL), wintypes.DWORD]
    api.CredUIPromptForCredentialsW.restype = wintypes.DWORD
    username, password = ctypes.create_unicode_buffer(ACCOUNT, 128), ctypes.create_unicode_buffer(MAX_KEY_BYTES + 1)
    info = CREDUI_INFO(cbSize=ctypes.sizeof(CREDUI_INFO),
        pszCaptionText='Mulow - Save Muse API key',
        pszMessageText='Enter your dedicated Baseten API key in Password. This is NOT your Windows password.\nSave for Mulow under this Windows user on this PC. No model call occurs on save.')
    save = wintypes.BOOL(False)
    # Native UI itself must neither search/reuse nor persist a generic credential.
    flags = 0x40000 | 0x80 | 0x2 | 0x8 | 0x100000
    try:
        result = api.CredUIPromptForCredentialsW(ctypes.byref(info), TARGET, None, 0, username,
            len(username), password, len(password), ctypes.byref(save), flags)
        if result == 1223:
            raise CredentialError('Key setup cancelled. No credential was saved.')
        if result != 0:
            raise CredentialError('Windows secure input did not complete. No credential was saved.')
        # Copy printable ASCII directly out of the native buffer, without logging or creating a Python key string.
        secret = bytearray()
        for character in password:
            number = ord(character)
            if number == 0:
                break
            if not 33 <= number <= 126:
                wipe(secret)
                raise CredentialError('Invalid API key. Nothing was saved.')
            secret.append(number)
        try:
            return validate_secret(secret)
        except Exception:
            wipe(secret)
            raise
    finally:
        ctypes.memset(password, 0, ctypes.sizeof(password))
        ctypes.memset(username, 0, ctypes.sizeof(username))


def secure_setup(vault, prompt=prompt_native_secret):
    if vault.exists():
        raise CredentialError('The exact Mulow key already exists; no replacement was attempted.')
    secret = restored = None
    try:
        secret = prompt()
        validate_secret(secret)
        vault.create(secret)
        restored = vault.read()
        validate_secret(restored)
        if not hmac.compare_digest(secret, restored):
            raise CredentialError('Stored key verification was not confirmed. No model call was made.')
        return {'stored': True, 'verified': True, 'providerCalls': 0, 'target': TARGET}
    finally:
        wipe(secret)
        wipe(restored)
