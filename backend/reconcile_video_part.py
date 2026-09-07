"""Resolve a queued video only after checking its destination Flickr account."""
import argparse
from video_queue import reconcile_part

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('photo_id')
    parser.add_argument('part', type=int, nargs='?')
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--verified-flickr-id')
    action.add_argument('--confirmed-absent', action='store_true')
    parser.add_argument('--verified-owner-id', help='Confirmed destination for legacy receipts without an account stamp')
    args = parser.parse_args()
    reconcile_part(args.photo_id, args.part, args.verified_flickr_id, args.confirmed_absent, args.verified_owner_id)
