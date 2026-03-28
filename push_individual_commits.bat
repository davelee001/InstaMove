@echo off
REM Run from any location; script will cd into the project path
cd /d "f:\InstaMove\InstaMove"

REM Initialize repo if needed and ensure main branch
git init
git checkout -b main

REM Set local git user
git config user.email "david.leekaleer@student.utamu.ac.ug"
git config user.name "David Leekaleer"

REM Add remote (replace if exists)


















REM Push to GitHub (you may be prompted for credentials or PAT)
git push -u origin main
git add package.json
git commit -m "Add package.json"
git add src\notifier.js
git commit -m "Add src/notifier.js"
git add src\invoice.js
git commit -m "Add src/invoice.js"
git add src\channel.js
git commit -m "Add src/channel.js"
git add src\encryption.js
git commit -m "Add src/encryption.js"
git add src\processor.js
git commit -m "Add src/processor.js"
git add src\app.js
git commit -m "Add src/app.js"
git add data\channels.json
git commit -m "Add data/channels.json"
git add data\requests.json
git commit -m "Add data/requests.json"
git add data\nodes.json
git commit -m "Add data/nodes.json"
git add config\invoice.json
git commit -m "Add config/invoice.json"
git add config\network.json
git commit -m "Add config/network.json"
git add config\encryption.json
git commit -m "Add config/encryption.json"
REM Commit files individually with short messages
git add config\app.json
git commit -m "Add config/app.json"
git remote remove origin 2>nul || (
	REM ignore
)
git remote add origin https://github.com/davelee001/InstaMove.git