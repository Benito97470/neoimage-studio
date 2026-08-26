# NeoImage Studio — démarrage sous Windows

Prérequis : **Node.js 22.13.0 ou plus récent**.

Ouvrez PowerShell dans le dossier `neoimage-studio`, puis exécutez :

```powershell
npm ci
npm run dev
```

L’adresse locale s’affichera dans PowerShell. Ouvrez-la dans votre navigateur.

## Vérifier la version de production

```powershell
npm run build
npm start
```

Les commandes npm de cette archive sont compatibles avec Windows : elles ne
dépendent ni de `bash`, ni de la syntaxe Linux `VARIABLE=valeur commande`.

## Clés API

Les clés OpenAI et Google ne sont jamais incluses dans l’archive. Ajoutez-les
depuis l’interface NeoImage. La synchronisation entre appareils nécessite un
compte NeoImage et votre phrase secrète.
