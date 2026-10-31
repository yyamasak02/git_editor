# Git Editor

ブラウザ(Chrome / Edge)だけで動く、ローカルgitフォルダのGUIエディタ。サーバー不要で GitHub Pages にデプロイできます。

- フォルダ選択 (File System Access API) + [isomorphic-git]
- status / stage / commit / branch / checkout / log / merge
- マージコンフリクトを箇所ごとに ours / theirs / 両方 / 手動編集で解消
- Claude API(自分のAPIキーをブラウザに保存)でコンフリクト解消案・コミットメッセージを生成
- リモート操作(fetch/push)は非対応

## 開発
```
npm install
npm run dev
npm test   # git操作層のNodeテスト
```

## 制約
- 実行権限ビット・シンボリックリンクは扱えません(実行ファイルが変更扱いになることがあります)
- rebase / stash / cherry-pick 等は未対応
