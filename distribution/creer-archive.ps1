# Assemble une copie autonome d'EasyTransfert, utilisable sur un PC Windows
# qui n'a pas Node.js. Le binaire node.exe de cette machine est embarque tel quel :
# c'est exactement la version avec laquelle le projet a ete teste.
#
# Usage : powershell -ExecutionPolicy Bypass -File distribution\creer-archive.ps1

$ErrorActionPreference = 'Stop'

$racine = Split-Path -Parent $PSScriptRoot
$sortie = Join-Path $racine 'dist'
$dossier = Join-Path $sortie 'EasyTransfert'
$archive = Join-Path $sortie 'EasyTransfert.zip'
$licenceNode = Join-Path $PSScriptRoot 'node-LICENSE.txt'

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js est introuvable sur cette machine : impossible de l'embarquer." }

$version = (& $node --version).TrimStart('v')
if ([version]($version -split '-')[0] -lt [version]'22.0.0') {
  throw "Node $version est trop ancien : le projet exige Node 22 ou plus."
}

Write-Host "Node $version embarque depuis $node"

# Redistribuer node.exe impose de joindre le texte de sa licence MIT. Le paquet
# Windows de Node ne l'installe pas : on le recupere une fois, puis on le garde
# en cache dans distribution/ pour que les constructions suivantes soient hors ligne.
if (-not (Test-Path $licenceNode)) {
  $url = "https://raw.githubusercontent.com/nodejs/node/v$version/LICENSE"
  Write-Host "Licence de Node absente, telechargement unique depuis $url"
  Invoke-WebRequest -Uri $url -OutFile $licenceNode -UseBasicParsing
}
if ((Get-Item $licenceNode).Length -lt 1000) {
  throw "Le fichier $licenceNode semble tronque : archive non conforme, construction interrompue."
}

Remove-Item $dossier -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $dossier 'node') | Out-Null

Copy-Item $node (Join-Path $dossier 'node\node.exe')
Copy-Item $licenceNode (Join-Path $dossier 'node\LICENSE.txt')
Copy-Item (Join-Path $racine 'server.js'), (Join-Path $racine 'package.json') $dossier
Copy-Item (Join-Path $racine 'src'), (Join-Path $racine 'public'), (Join-Path $racine 'node_modules') $dossier -Recurse
Copy-Item (Join-Path $PSScriptRoot 'Lancer EasyTransfert.bat'), (Join-Path $PSScriptRoot "Mode d'emploi.html") $dossier
Copy-Item (Join-Path $racine 'LICENSE') (Join-Path $dossier 'LICENSE.txt')

# Le dossier partage appartient a la personne qui recevra la copie : il ne doit
# jamais embarquer les fichiers de la machine qui fabrique l'archive.
Remove-Item (Join-Path $dossier 'partage') -Recurse -Force -ErrorAction SilentlyContinue

Remove-Item $archive -Force -ErrorAction SilentlyContinue
Compress-Archive -Path $dossier -DestinationPath $archive -CompressionLevel Optimal

$taille = [math]::Round((Get-Item $archive).Length / 1MB, 1)
Write-Host "Archive prete : $archive ($taille Mo)"
