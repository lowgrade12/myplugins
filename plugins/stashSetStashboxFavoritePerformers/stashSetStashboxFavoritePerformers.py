import json
import log
import os
import pathlib
import sys
from favorite_performers_sync import set_stashbox_favorite_performers, set_stashbox_favorite_performer
try:
    from stashlib.stash_database import StashDatabase
    from stashlib.stash_interface import StashInterface
except ModuleNotFoundError:
    print(f"pystashlib module not found. Install it using: {sys.executable} -m pip install pystashlib", file=sys.stderr)
    print(f"Make sure the Python Executable Path in Stash settings matches: {sys.executable}", file=sys.stderr)
    sys.exit()

STASHDB_ENDPOINT = 'https://stashdb.org/graphql'

json_input = json.loads(sys.stdin.read())
args = json_input.get('args', {})
name = args.get('name')
hook_context = args.get('hookContext')

client = StashInterface(json_input["server_connection"])

def get_database_config():
    result = client.callGraphQL("""query Configuration { configuration { general { databasePath, blobsPath, blobsStorage } } }""")
    database_path = result["configuration"]["general"]["databasePath"]
    blobs_path = result["configuration"]["general"]["blobsPath"]
    blobs_storage = result["configuration"]["general"]["blobsStorage"]
    log.debug(f"databasePath: {database_path}")
    return database_path, blobs_path, blobs_storage

def get_stashboxes():
    """Get configured stashboxes from Stash"""
    result = client.callGraphQL("""query Configuration { configuration { general { stashBoxes { endpoint api_key } } } }""")
    return result.get("configuration", {}).get("general", {}).get("stashBoxes", [])

def get_performer(performer_id):
    """Get performer details including stash_ids and favorite status"""
    result = client.callGraphQL("""
        query FindPerformer($id: ID!) {
            findPerformer(id: $id) {
                id
                name
                favorite
                stash_ids {
                    endpoint
                    stash_id
                }
            }
        }
    """, {"id": performer_id})
    return result.get("findPerformer")

plugin_settings = client.callGraphQL("""query Configuration { configuration { plugins } }""")['configuration']['plugins'].get('stashSetStashboxFavoritePerformers', {})
tag_errors = plugin_settings.get('tagErrors', False)
tag_name = plugin_settings.get('tagName')

# Handle hook context (triggered by Performer.Update.Post)
if hook_context:
    performer_id = hook_context.get('id')
    if performer_id:
        log.debug(f"Hook triggered for performer ID: {performer_id}")
        performer = get_performer(performer_id)
        if performer and performer.get('stash_ids'):
            stashboxes = get_stashboxes()
            stashbox_map = {sb.get('endpoint'): sb.get('api_key') for sb in stashboxes if sb.get('endpoint') and sb.get('api_key')}
            
            for stash_id_entry in performer['stash_ids']:
                endpoint = stash_id_entry.get('endpoint')
                stash_id = stash_id_entry.get('stash_id')
                
                # Only sync with stashdb.org
                if endpoint != STASHDB_ENDPOINT:
                    continue
                
                api_key = stashbox_map.get(endpoint)
                if not api_key:
                    log.warning(f"No API key found for endpoint: {endpoint}")
                    continue
                
                favorite = performer.get('favorite', False)
                log.info(f"Syncing performer {performer.get('name')} (stash_id={stash_id}) favorite={favorite} to {endpoint}")
                set_stashbox_favorite_performer(endpoint, api_key, stash_id, favorite)
        else:
            log.debug(f"Performer {performer_id} has no stash_ids, skipping")
    else:
        log.debug("No performer ID in hook context")

# Handle task execution (triggered manually or by JS)
elif name == 'favorite_performers_sync':
    endpoint = args.get('endpoint')
    api_key = args.get('api_key')
    try:
        db = StashDatabase(*get_database_config())
    except Exception as e:
        log.error(str(e))
        sys.exit(0)
    set_stashbox_favorite_performers(db, endpoint, api_key, tag_errors, tag_name)
    db.close()
elif name == 'favorite_performer_sync':
    endpoint = args.get('endpoint')
    api_key = args.get('api_key')
    stash_id = args.get('stash_id')
    favorite = args.get('favorite')
    log.debug(f"Favorite performer sync: endpoint={endpoint}, stash_id={stash_id}, favorite={favorite}")
    set_stashbox_favorite_performer(endpoint, api_key, stash_id, favorite)
