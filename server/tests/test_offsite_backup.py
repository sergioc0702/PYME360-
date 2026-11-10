"""Compatibility of automatic encrypted backups with the browser restore format."""

import base64
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from sys import path as sys_path

sys_path.insert(0, str(Path(__file__).resolve().parents[1]))
from offsite_backup import write_backup  # noqa: E402

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:
    AESGCM = None


@unittest.skipUnless(AESGCM, "Requiere cryptography del respaldo opcional")
class OffsiteBackupTests(unittest.TestCase):
    def test_written_copy_recovers_the_business_state_and_rejects_wrong_password(self):
        with tempfile.TemporaryDirectory() as folder:
            state = {"schemaVersion": 7, "sales": [{"id": "sale-1", "total": 40000}],
                     "products": [{"id": "product-1", "stock": 6}]}
            target = write_backup(state, "recovery-test-password", Path(folder))
            self.assertTrue(target.is_file())
            self.assertEqual(list(Path(folder).glob("*.tmp")), [])
            document = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(document["format"], "pyme360-encrypted-backup")
            salt = base64.b64decode(document["salt"])
            iv = base64.b64decode(document["iv"])
            ciphertext = base64.b64decode(document["data"])
            bad_key = hashlib.pbkdf2_hmac("sha256", b"wrong", salt, document["iterations"], 32)
            with self.assertRaises(Exception):
                AESGCM(bad_key).decrypt(iv, ciphertext, None)
            key = hashlib.pbkdf2_hmac("sha256", b"recovery-test-password", salt, document["iterations"], 32)
            restored = json.loads(AESGCM(key).decrypt(iv, ciphertext, None))
            self.assertEqual(restored["state"], state)
