from pathlib import Path
import argparse,shutil,subprocess,plistlib
p=argparse.ArgumentParser();p.add_argument('--node-directory',required=True,type=Path);a=p.parse_args()
r=Path(__file__).resolve().parent;n=a.node_directory.resolve();assert (n/'bin/node').is_file() and (n/'LICENSE').is_file()
app=r/'dist/Mulow.app';assert not app.exists(),'Existing output is preserved'
res=app/'Contents/Resources';mac=app/'Contents/MacOS';res.mkdir(parents=True);mac.mkdir()
shutil.copytree(r/'runtime',res/'runtime');(res/'mac').mkdir();shutil.copy2(r/'mac/start-mac-session.mjs',res/'mac/start-mac-session.mjs');shutil.copy2(n/'bin/node',mac/'node');shutil.copy2(n/'LICENSE',res/'NODE-LICENSE.txt')
info={'CFBundleName':'Mulow','CFBundleDisplayName':'Mulow','CFBundleIdentifier':'local.mulow.mac.v7','CFBundleExecutable':'Mulow','CFBundlePackageType':'APPL','CFBundleShortVersionString':'7.0.7','CFBundleVersion':'7.0.7','LSMinimumSystemVersion':'15.0','NSHighResolutionCapable':True,'NSAppTransportSecurity':{'NSAllowsLocalNetworking':True},'NSMicrophoneUsageDescription':'Mulow uses the microphone only when you choose voice input.','LSApplicationCategoryType':'public.app-category.developer-tools'}
with (app/'Contents/Info.plist').open('wb') as f:plistlib.dump(info,f)
subprocess.run(['/usr/bin/swiftc','-O','-module-cache-path',str(r/'.swift-module-cache'),'-target','arm64-apple-macosx15.0','-framework','Cocoa','-framework','WebKit','-framework','Security','-framework','LocalAuthentication',str(r/'mac/MuseKeychain.swift'),str(r/'mac/main.swift'),'-o',str(mac/'Mulow')],check=True)
for target in [mac/'node',app]:subprocess.run(['/usr/bin/codesign','--force','--sign','-',str(target)],check=True)
subprocess.run(['/usr/bin/codesign','--verify','--deep','--strict',str(app)],check=True)
print(app)
