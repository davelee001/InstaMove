$repoPath = "f:\InstaMove\InstaMove"
Set-Location $repoPath

# Initialize repo and create main branch
git init
git checkout -b main 2>$null

# Configure local git user
git config user.email "david.leekaleer@student.utamu.ac.ug"
git config user.name "David Leekaleer"

# Ensure remote is set to the provided repo
$remotes = git remote
if ($remotes -match 'origin') {
  git remote remove origin
}
git remote add origin https://github.com/davelee001/InstaMove.git

# Commit files individually with short messages
git add "config/app.json"
git commit -m "Add config/app.json"

git add "config/encryption.json"
git commit -m "Add config/encryption.json"

git add "config/network.json"
git commit -m "Add config/network.json"

git add "config/invoice.json"
git commit -m "Add config/invoice.json"

git add "data/nodes.json"
git commit -m "Add data/nodes.json"

git add "data/requests.json"
git commit -m "Add data/requests.json"

git add "data/channels.json"
git commit -m "Add data/channels.json"

git add "src/app.js"
git commit -m "Add src/app.js"

git add "src/processor.js"
git commit -m "Add src/processor.js"

git add "src/encryption.js"
git commit -m "Add src/encryption.js"

git add "src/channel.js"
git commit -m "Add src/channel.js"

git add "src/invoice.js"
git commit -m "Add src/invoice.js"

git add "src/notifier.js"
git commit -m "Add src/notifier.js"

git add "package.json"
git commit -m "Add package.json"

# Push to GitHub (you may be prompted for credentials or PAT)
git push -u origin main
