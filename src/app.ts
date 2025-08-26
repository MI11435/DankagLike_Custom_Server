import express, { Application } from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import cors from "cors";
import argon2 from "argon2";
import { dbConfig } from "./config/db";

// Express のアプリケーションを作成
const app: Application = express();

// パス指定より前に指定する
// body-parser settings
app.use(express.json());
app.use(cors());
// 別のlocalhostからアクセスできるようにする
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE");
  next();
});

// スキーマを作成
const contentsSchema = new mongoose.Schema({
  id: { type: Number, unique: true, required: true },
  contentType: { type: Number, required: true },
  title: { type: String },
  publisher: { type: String },
  description: { type: String },
  downloadUrl: { type: String },
  imageUrl: { type: String },
  date: { type: String, required: true },
  downloadCount: { type: Number },
  voteAverageScore: { type: Number },
  songInfo: {
    difficulties: { type: [Number] },
    hasLua: { type: Boolean },
  },
});
const contentsResource = mongoose.model("contents", contentsSchema);

const votesSchema = new mongoose.Schema({
  id: { type: Number, unique: true, required: true },
  contentId: { type: Number, required: true },
  userId: { type: String, required: true },
  name: { type: String },
  score: { type: Number },
  comment: { type: String },
  like: { type: Number },
  date: { type: String, required: true },
});
const votesResource = mongoose.model("votes", votesSchema);

const likesSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  voteId: { type: Number, require: true },
});
const likesResource = mongoose.model("likes", likesSchema);

const accountsSchema = new mongoose.Schema({
  accountId: { type: String, required: true },
  password: { type: String, require: true },
  token: { type: String, require: false },
  name: { type: String, require: false },
  icon: { type: Number, require: false }
});
const accountsResource = mongoose.model("accounts", accountsSchema);

const rankingSchema = new mongoose.Schema({
  songTitle: { type: String, require: true },
  difficulty: { type: Number, require: true },
  chartHash: { type: String, require: true },
  accountId: { type: String, required: false },
  score: { type: Number, require: false },
  abCount: { type: Number, require: false },
  date: { type: String, require: true }
});
const rankingResource = mongoose.model("ranking", rankingSchema);

// MongoDBに自動インクリメントの機能がないので対策として専用のカウンターのテーブルを用意する
const counterSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 }
});
const Counter = mongoose.model('Counter', counterSchema);

async function getNextSequence(name: String) {
  const result = await Counter.findOneAndUpdate(
    { name },                      // 条件: カウンター名
    { $inc: { seq: 1 } },          // 更新: seqをインクリメント
    {
      new: true,                   // 更新後のドキュメントを返す
      upsert: true                 // 存在しない場合は新規作成
    }
  );

  return result.seq;
}

// 特に返すべきデータがない場合でも、成功を示すメッセージを返す用
const successMessage = { message: "Operation was successful." };

// JWTシークレット
const secret = 'oauthServerSampleSecret';

app.set('superSecret', secret);

// 認証用ミドルウェア (Authorizationを適用したサーバーにしたいときに使用)
// function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
//   const authHeader = req.headers["authorization"];

//   // 許可するキー（アプリ側で設定するAuthorization）
//   const VALID_TOKEN = "MyAppSecretToken";

//   if (!authHeader || authHeader !== `Bearer ${VALID_TOKEN}`) {
//     return res.status(401).json({ message: "Unauthorized" });
//   }

//   next();
// }

// トランザクション実行のヘルパー
async function runWithTransaction(task: (session: mongoose.ClientSession) => Promise<void>) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    await task(session);
    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

/**
 * [機能のサポート情報]
 * 機能のサポート情報を返します
 */
app.get("/support", async (req, res) => {
  res.status(200).json({
    contents: true,
    accounts: true,
    ranking: true,
  });
});

//--------------------------
// コンテンツ関連API
//--------------------------

/**
 * [コンテンツ一覧API]
 * コンテンツ一覧を全件取得して返却します
 **/
app.get("/contents", async (req, res) => {
  const contents = await contentsResource.find();
  var list: {
    id: number;
    contentType: number;
    title: string | null | undefined;
    publisher: string | null | undefined;
    date: string;
    downloadCount: number | null | undefined;
    voteAverageScore: number | null | undefined;
    songInfo:
    | {
      difficulties: number[];
      hasLua?: boolean | null | undefined;
    }
    | null
    | undefined;
  }[] = [];

  contents.forEach((c) =>
    list.push({
      id: c.id,
      contentType: c.contentType,
      title: c.title,
      publisher: c.publisher,
      date: c.date,
      downloadCount: c.downloadCount,
      voteAverageScore: c.voteAverageScore,
      songInfo: c.songInfo,
    })
  );

  res.status(200).json({ contents: list });
});

app.get("/contents/:id", async (req, res) => {
  // 指定したIDのコンテンツを取得する
  const id = req.params.id;
  const contents = await contentsResource.find({ id: id });
  res.status(200).json({ contents: contents });
});

/**
 * [コンテンツ詳細API]
 * コンテンツ詳細を取得して返却します
 **/
app.get("/contents/:id/description", async (req, res) => {
  //console.log("/contents/"+req.params.id+"/description");
  // 指定したIDのコンテンツを取得する
  const id = req.params.id;
  const content = await contentsResource.findOne({ id: id });
  res.status(200).json({
    description: content?.description,
    downloadUrl: content?.downloadUrl,
    imageUrl: content?.imageUrl,
  });
});

/**
 * [コンテンツのダウンロード済みAPI]
 * コンテンツのダウンロードカウントを1増やします
 **/
app.put("/contents/:id/downloaded", async (req, res) => {
  //console.log("/contents/"+req.params.id+"/downloaded");
  const id = req.params.id;
  await contentsResource
    .updateOne({ id: id }, { $inc: { downloadCount: 1 } })
    .then(() => res.status(200).send(successMessage))
    .catch((error: any) => res.status(500).json({ message: error.message }));
});

/**
 * [コンテンツ評価API]
 * コンテンツ評価を全件取得する (デバッグ用)
 **/
app.get("/votes", async (req, res) => {
  const votes = await votesResource.find();
  res.status(200).json({ votes: votes });
});

/**
 * [コンテンツ評価API]
 * contentIdのコンテンツ評価を取得する
 **/
app.get("/contents/:id/vote", async (req, res) => {
  const id = req.params.id;
  const votes = await votesResource.find({ contentId: id });
  res.status(200).json({ votes: votes });
});

/**
 * [コンテンツ評価API]
 * contentIdのコンテンツ評価を新規登録する
 **/
app.post("/contents/:id/vote", async (req, res) => {
  const contentId = req.params.id;
  const voteId = await getNextSequence('voteId');

  await votesResource
    .updateOne(
      { userId: req.body.userId },
      {
        id: voteId,
        contentId: req.body.contentId,
        userId: req.body.userId,
        name: req.body.name,
        score: req.body.score,
        comment: req.body.comment,
        like: req.body.like,
        date: req.body.date,
      },
      { upsert: true }
    )
    .then(() => {
      res.status(200).send(successMessage);
    })
    .catch((e) => {
      res.status(500).send(e);
    });

  updateVoteAverageScore(Number(contentId));
});

/**
 * [コンテンツ評価API]
 * contentIdのコンテンツ評価を編集する
 * 編集したらいいね数は0に戻る仕様
 **/
app.put("/contents/:id/vote", async (req, res) => {
  const contentId = req.params.id;
  const voteId = req.body.id;

  await votesResource
    .updateOne(
      {
        id: voteId,
        userId: req.body.userId
      },
      {
        contentId: req.body.contentId,
        userId: req.body.userId,
        name: req.body.name,
        score: req.body.score,
        comment: req.body.comment,
        like: 0, //いいね数を変えない場合はreq.body.like
        date: req.body.date,
      },
      { upsert: false }
    )
    .catch((e) => {
      res.status(500).send(e);
    });

  // 編集されたVoteをいいね一覧から削除
  await likesResource.deleteMany({ voteId: voteId })
    .then(() => {
      res.status(200).send(successMessage);
    })
    .catch((e) => {
      res.status(500).send(e);
    });

  updateVoteAverageScore(Number(contentId));
});

/**
 * コンテンツの評価平均を更新する
 * @param contentId
 * @returns
 */
const updateVoteAverageScore = async (contentId: Number) => {
  const contentVotes = await votesResource.find({ contentId: contentId });

  if (contentVotes.length == 0) {
    return;
  }

  let total = 0;
  contentVotes.forEach((v) => (total += Number(v.score)));
  const averageScore = total / contentVotes.length;
  await contentsResource.updateOne(
    { id: contentId },
    { $set: { voteAverageScore: averageScore } }
  );
};

/**
 * [ユーザーのいいね情報取得API]
 */
app.get("/likes/:userId", async (req, res) => {
  const userId = req.params.userId;
  const likes = await likesResource.find({ userId: userId });
  res.status(200).json({ likes: likes });
});

/**
 * [評価のいいねAPI]
 * 評価のいいね(like)を1増やします
 * 評価対象はRequestBodyに設定されます
 **/
app.put("/likes/:userId", async (req, res) => {
  const voteId = req.body.voteId;

  await likesResource
    .insertMany({
      userId: req.params.userId,
      voteId: voteId,
    })
    .catch((error: any) => res.status(500).json({ message: error.message }));

  await votesResource
    .updateOne(
      { id: voteId },
      { $inc: { like: 1 } }
    )
    .then(() => res.status(200).send(successMessage))
    .catch((error: any) => res.status(500).json({ message: error.message }));
});

//-----------------------------
// アカウント、ログイン認証関連
//-----------------------------

/**
 * [アカウント登録API]
 * POST http://localhost:3000/accounts
 * 新規アカウントを登録します
 */
app.post('/accounts', async (req, res) => {
  try {
    const { accountId, password, name, icon } = req.body;

    // アカウントIDの重複チェック
    const existingAccount = await accountsResource.findOne({ accountId });
    if (existingAccount) {
      res.status(400).json({
        success: false,
        message: 'Account ID already exists.\nこのアカウントIDは既に使用されています。'
      });
      return;
    }

    // アカウント作成
    const newAccount = new accountsResource({ accountId, password, name, icon });
    await newAccount.save();

    res.status(201).json({
      success: true,
      message: 'Account successfully created.\nアカウントが正常に作成されました。',
      account: newAccount
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * [アカウント更新API]
 * PUT http://localhost:3000/accounts
 * アカウント情報を更新します
 */
app.put('/accounts', async (req, res) => {
  try {
    const { accountId, token, name, icon, password } = req.body;

    // 必須チェック
    if (!accountId || !token) {
      res.status(400).json({
        success: false,
        message: 'accountId and token are required.\nアカウントIDとトークンが必要です。'
      });
      return;
    }

    // 更新データを明示的に定義（セキュリティ対策）
    const updatedData: any = {};
    if (name !== undefined) updatedData.name = name;
    if (icon !== undefined) updatedData.icon = icon;
    if (password !== undefined) updatedData.password = password;

    const result = await accountsResource.updateOne(
      { accountId, token },
      { $set: updatedData }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({
        success: false,
        message: 'Account not found or invalid token.\nアカウントが見つからないか、トークンが無効です。'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Account updated successfully.\nアカウントが正常に更新されました。'
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * [アカウントログインAPI]
 * POST http://localhost:3000/accountLogin
 */
app.post('/accountLogin', async (req, res) => {
  try {
    const { accountId, password } = req.body;
    let Not_hash_password = false;

    // アカウントを検索
    const account = await accountsResource.findOne({ accountId });
    if (!account) {
      res.status(401).json({ success: false, message: 'Account not found.\nそんなアカウントねーよ' });
      return;
    }

    // パスワードチェック
    //argon2.verifyの第一引数がハッシュ化されていないとエラーが出るようになったので分けた
    if (account.password !== password ){
      if ( ! await argon2.verify(account.password,password)) {
        res.status(401).json({ success: false, message: 'Wrong password.\nお前ニセモンやろ' });
      return;
      }
    }else{
      Not_hash_password = true;
    }

    // JWTトークン生成
    const token = jwt.sign({ aid: account.accountId }, app.get('superSecret'), {
      expiresIn: '24h'
    });
    // まだパスワードのハッシュ化をしていない人にハッシュ化をする
    if(Not_hash_password){
      account.password = await argon2.hash(password);
    }
    // トークンを保存して更新
    account.token = token;
    await account.save();

    // 成功レスポンス
    res.status(200).json({
      success: true,
      message: 'Authentication successful.\nログイン成功',
      account
    });

  } catch (err: any) {
    res.status(500).json({ success: false, message: 'エラー\n ' + err.message });
  }
});

//--------------------------
// ランキング関連API
//--------------------------
app.get("/ranking", async (req, res) => {
  try {
    const { chartHash, difficulty } = req.query;

    // パラメータチェック
    if (!chartHash || !difficulty) {
      res.status(400).json({
        error: "chartHash and difficulty are required\nチャートハッシュと難易度が必要です。"
      });
      return;
    }

    // 型を揃える
    const query = {
      chartHash: String(chartHash).trim(),
      difficulty: Number(difficulty),
    };

    // ランキング上位200件を取得（スコア降順 → abCount降順）
    const ranking = await rankingResource.find(query)
      .sort({ score: -1, abCount: -1 })
      .limit(200)
      .lean();

    // アカウント情報をまとめて取得
    const accounts = await accountsResource.find({
      accountId: { $in: ranking.map(r => r.accountId).filter(Boolean) }
    }).lean();

    // accountId → アカウント のマップを作成
    const accountMap = new Map(accounts.map(a => [a.accountId, a]));

    // ランキングデータにアカウント情報を付与
    const data = ranking.map(r => {
      const accountId = typeof r.accountId === "string" ? r.accountId : "";
      const account = accountId ? accountMap.get(accountId) : undefined;
      return {
        score: r.score,
        abCount: r.abCount,
        date: r.date, // 登録/更新日を返す
        account: account
          ? { name: account.name, icon: account.icon }
          : null
      };
    });

    res.status(200).json({ ranking: data });
  } catch (err) {
    res.status(500).json({ error: "Internal server error\nサーバーエラー" });
  }
});

/**
 * [ランキング登録API]
 * ランキングを登録または更新します
 * POST http://localhost:3000/ranking
 */
app.post("/ranking", async (req, res) => {
  try {
    const { songTitle, difficulty, chartHash, accountId, accountToken, score, maxScore } = req.body;

    // 必須チェック
    if (!songTitle || !chartHash || !accountId || !accountToken || score == null || maxScore == null) {
      res.status(400).json({ error: "songTitle, chartHash, accountId, accountToken, score, and maxScore are required パラメータが不足しています。" });
      return;
    }

    // トークンの検証
    accountsResource.findOne({ accountId }).then(account => {
      if (!account || account.token !== accountToken) {
        return res.status(403).json({ error: "Your account login token is invalid トークンが無効です。" });
      }
    });

    // 今日の日付を "YYYY-MM-DD" 形式で取得
    const today = new Date().toISOString().split("T")[0];

    // 既存データを検索
    const existing = await rankingResource.findOne({ songTitle, difficulty, chartHash, accountId });

    if (existing) {

      let updated = false;
      let AB = false;

      // スコアが更新された場合のみ更新
      if (score > (existing.score ?? 0)) {
        existing.score = score;
        existing.date = today;  // 更新した日付を記録
        updated = true;
      }

      // 満点を取った場合はABカウンター加算
      if (score === maxScore) {
        existing.abCount = (existing.abCount ?? 0) + 1;
        existing.date = today;  // プレイ日を更新
        updated = true;
        AB = true;
      }

      // 更新があった場合のみ保存
      if (updated) {
        await existing.save();
        if(AB) {
          res.status(200).json({ message: "Ranking updated successfully. ALL BRILLIANT!!!" });
          return;
        }else{
          res.status(200).json({ message: "Ranking updated successfully. スコア更新！" });
          return;
        }
      } else {
        res.status(200).json({ message: "No ranking update needed. ランキングの更新はありません。" });
        return;
      }
    }

    // データが存在しない場合 → 新規登録
    const rankingData = new rankingResource({
      songTitle,
      difficulty,
      chartHash,
      accountId,
      score,
      abCount: score === maxScore ? 1 : 0, // 満点なら初期値1
      date: today
    });
    await rankingData.save();
    if (score === maxScore){
      res.status(201).json({ message: "1ST TAKE ALL BRILLIANT ?!?!?!?!?!?!" });
    }else{
      res.status(201).json({ message: "Ranking created successfully. 新規スコアをアップロードしました。" });
    }
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});


// Express を立ち上げるポート番号
const EXPRESS_PORT = process.env.PORT || 3000;

(async function main() {
  // 改行させないlog出力
  process.stdout.write("DB接続待ち...");
  // MongoDB への接続
  await mongoose.connect(dbConfig.url, {
    user: dbConfig.user,
    pass: dbConfig.pass,
    dbName: dbConfig.dbName,
  });
  console.log("[OK]");

  try {
    // 指定したポートでリッスンするサーバを立ち上げる
    app.listen(EXPRESS_PORT, () => {
      console.log("server running");
    });
  } catch (e: any) {
    console.error(e.message);
  }
})();
