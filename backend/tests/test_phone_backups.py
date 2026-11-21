import hashlib
from pathlib import Path
import tempfile
import unittest
import uuid
from fastapi import HTTPException
from phone_backups import PhoneBackupStore, AssetPlan


class PhoneBackupTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.store=PhoneBackupStore(self.temp.name)
        self.owner=str(uuid.uuid4());self.other=str(uuid.uuid4())
        self.payloads=[b'original still',b'paired live video',b'edit adjustments']
        self.plan=AssetPlan(device_id=uuid.uuid4(),asset_identifier='Photos/local-id',revision='a'*64,
            resources=[dict(key=str(i),filename='../private.jpg',media_type='image/jpeg',byte_size=len(data),sha256=hashlib.sha256(data).hexdigest()) for i,data in enumerate(self.payloads)])
        self.receipt=self.store.plan(self.owner,self.plan)

    def upload(self,index,data=None):
        self.store.append(self.owner,self.receipt['id'],self.receipt['resources'][index]['id'],0,data or self.payloads[index])

    def test_every_live_photo_resource_is_required_before_verified(self):
        self.upload(0);self.upload(1)
        with self.assertRaises(HTTPException):self.store.verify(self.owner,self.receipt['id'])
        self.assertEqual(self.store.status(self.owner,self.receipt['id'])['state'],'pending')
        self.upload(2)
        verified=self.store.verify(self.owner,self.receipt['id'])
        self.assertEqual(verified['state'],'verified')
        self.assertTrue(verified['verified_at'])
        self.assertFalse((Path(self.temp.name)/'private.jpg').exists())

    def test_retries_are_idempotent_but_changed_chunk_is_rejected(self):
        self.upload(0);self.upload(0)
        with self.assertRaises(HTTPException):self.upload(0,b'X'*len(self.payloads[0]))
        self.assertEqual(self.store.status(self.owner,self.receipt['id'])['resources'][0]['received_bytes'],len(self.payloads[0]))

    def test_wrong_household_cannot_read_upload_or_verify(self):
        with self.assertRaises(HTTPException):self.store.status(self.other,self.receipt['id'])
        with self.assertRaises(HTTPException):self.store.append(self.other,self.receipt['id'],self.receipt['resources'][0]['id'],0,self.payloads[0])
        with self.assertRaises(HTTPException):self.store.verify(self.other,self.receipt['id'])

    def test_reread_detects_corruption_even_after_successful_backup(self):
        for i in range(3):self.upload(i)
        self.store.verify(self.owner,self.receipt['id'])
        directory=self.store.directory(self.owner,self.receipt['id'])
        path=self.store.resource_file(directory,self.receipt['resources'][1])
        path.write_bytes(b'X'*len(self.payloads[1]))
        with self.assertRaises(HTTPException):self.store.verify(self.owner,self.receipt['id'])

    def test_manifest_changes_cannot_reuse_a_revision(self):
        changed=self.plan.model_copy(deep=True);changed.resources[0].sha256='b'*64
        with self.assertRaises(HTTPException):self.store.plan(self.owner,changed)
        self.assertEqual(self.store.plan(self.owner,self.plan)['id'],self.receipt['id'])

    def test_registration_failure_does_not_mark_resource_safe_to_delete(self):
        for i in range(3):self.upload(i)
        def failed(*args):raise RuntimeError('database unavailable')
        with self.assertRaises(RuntimeError):self.store.verify(self.owner,self.receipt['id'],failed)
        self.assertEqual(self.store.status(self.owner,self.receipt['id'])['state'],'pending')


if __name__=='__main__':unittest.main()
