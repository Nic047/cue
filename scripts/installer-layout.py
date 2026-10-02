"""Build-only Finder layout; no Finder automation or app launch required."""
import sys
import json
from pathlib import Path
from ds_store import DSStore
from mac_alias import Alias
volume = Path(sys.argv[1])
config = json.loads(sys.argv[2])
w = config["windowSize"]
p = config["windowPosition"]
a = config["appPosition"]
f = config["applicationFolderPosition"]
background = volume / '.background' / 'background.png'
with DSStore.open(str(volume / '.DS_Store'), 'w+') as store:
    store['.']['bwsp'] = {
        'ShowStatusBar': False, 'ShowPathbar': False, 'ShowToolbar': False,
        'PreviewPaneVisibility': False, 'SidebarWidth': 0,
        'ShowTabView': False, 'ShowSidebar': False, 'ContainerShowSidebar': False,
        "WindowBounds": "{{%d, %d}, {%d, %d}}" % (p["x"], p["y"], w["width"], w["height"]),
    }
    store['.']['icvp'] = {
        'viewOptionsVersion': 1, 'backgroundType': 2,
        'backgroundImageAlias': Alias.for_file(str(background)).to_bytes(),
        'iconSize': 80.0, 'textSize': 13.0, 'gridSpacing': 100.0,
        'gridOffsetX': 0.0, 'gridOffsetY': 0.0, 'arrangeBy': 'none',
        'scrollPositionX': 0.0, 'scrollPositionY': 0.0,
        'backgroundColorRed': 0.065, 'backgroundColorGreen': 0.065, 'backgroundColorBlue': 0.065,
        'labelOnBottom': True, 'showIconPreview': False, 'showItemInfo': False,
    }
    store['.']['vSrn'] = ('long', 1)
    store['.']['icvl'] = ('type', b'icnv')
    store['Cue.app']['Iloc'] = (a["x"], a["y"])
    store['Applications']['Iloc'] = (f["x"], f["y"])
# Catch an unreadable layout before distributing the image.
with DSStore.open(str(volume / '.DS_Store'), 'r') as store:
    assert store['.']['icvl'] == (b'type', b'icnv')
    assert store['.']['icvp']['backgroundType'] == 2
    assert store['Cue.app']['Iloc'] == (a["x"], a["y"])
    assert store['Applications']['Iloc'] == (f["x"], f["y"])
