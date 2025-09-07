import express, { Application } from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import cors from "cors";
//import bcrypt from "bcrypt";
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

//--------------------------
// DBスキーマ定義
//--------------------------

// コンテンツ情報
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

// コンテンツ評価情報
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

// いいね情報
const likesSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  voteId: { type: Number, require: true },
});
const likesResource = mongoose.model("likes", likesSchema);

// アカウント情報
const accountsSchema = new mongoose.Schema({
  accountId: { type: String, required: true },
  password: { type: String, require: true },
  token: { type: String, require: false },
  name: { type: String, require: false },
  icon: { type: Number, require: false },
  banned: { type: Boolean, require: false, default: false }
});
const accountsResource = mongoose.model("accounts", accountsSchema);

// ランキング情報
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

//--------------------------
// 共通設定、関数
//--------------------------

// 特に返すべきデータがない場合でも、成功を示すメッセージを返す用
const successMessage = { message: "Operation was successful." };

// JWTシークレット
const secret = 'oauthServerSampleSecret';

app.set('superSecret', secret);

/**
 * カウンターをインクリメントして次の値を取得する関数
 * @param name カウンター名
 * @returns インクリメント後の値
 */
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
// async function runWithTransaction(task: (session: mongoose.ClientSession) => Promise<void>) {
//   const session = await mongoose.startSession();
//   try {
//     session.startTransaction();
//     await task(session);
//     await session.commitTransaction();
//   } catch (err) {
//     await session.abortTransaction();
//     throw err;
//   } finally {
//     session.endSession();
//   }
// }

//--------------------------
// サポート情報API
//--------------------------

/**
 * [機能のサポート情報]
 * 機能のサポート情報を返します
 */
app.get("/support", async (req, res) => {
  res.status(200).json({
    contents: true,
    accounts: true,
    ranking: true,
    options: {
      requireAccountEmail: false, // アカウント登録にメールアドレスを必須にするか
    }
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
  await likesResource.deleteMany({voteId: voteId})
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
    // メールアドレスも受け取るが、現状は使用しない
    const { email, accountId, password } = req.body;

    // アカウントIDの重複チェック
    const existingAccount = await accountsResource.findOne({ accountId });
    if (existingAccount) {
      res.status(400).json({
        success: false,
        message: 'Account ID already exists.\nこのアカウントIDは既に使用されています。'
      });
      return;
    }

    // パスワードをハッシュ化
    //const saltRounds = 10; // コスト（強度）
    // 内部的にランダムなソルトを自動生成
    //const hashedPassword = await bcrypt.hash(password, saltRounds);
    const hashedPassword = await argon2.hash(password);

    // アカウント作成
    const newAccount = new accountsResource({
      accountId: accountId,
      password: hashedPassword,
      name: accountId,
      icon: 0
    });
    await newAccount.save();

    res.status(201).json({
      success: true,
      message: 'Account successfully created.\nアカウントが正常に作成されました。',
      account: {
        accountId: newAccount.accountId,
        name: newAccount.name,
        icon: newAccount.icon
        // passwordは返さない
      }
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

    // パスワード更新がある場合はハッシュ化
    if (password !== undefined) {
      //const saltRounds = 10;
      // 内部的にランダムなソルトを自動生成
      //updatedData.password = await bcrypt.hash(password, saltRounds);
      updatedData.password = await argon2.hash(password);
    }

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
 * POST http://localhost:3000/accounts/login
 */
app.post('/accounts/login', async (req, res) => {
  try {
    const { accountId, password } = req.body;

    // アカウントを検索
    const account = await accountsResource.findOne({ accountId });
    if (!account) {
      res.status(401).json({ success: false, message: 'Account not found.\nそんなアカウントねーよ' });
      return;
    }

    // バンフラグが存在しない場合は false に初期化
    if (typeof account.banned === "undefined") {
      account.banned = false;
      await account.save();
    }

    // バンされている場合
    if (account.banned === true) {
      res.status(403).json({ success: false, message: 'This account has been banned.\nお前BAN。過去の行いを反省しろ。' });
      return;
    }

    if (typeof account.password !== "string") {
      res.status(500).json({ success: false, message: 'Account password is invalid.\nパスワードが無効だってよ。なに入れたんだよ()' });
      return;
    }

    //万が一req.passwordが20文字超過していたらエラーを吐かせる
    if (20 < password.length){
      res.status(401).json({ success: false, message: `You're a Cracker.\nこのメッセージが出ているという事は、貴方はクラッカーです。`});
      return;
    }

    let isMatch = false;

    try {
      // bcrypt比較（ハッシュ済みならここで通る）
      //isMatch = await bcrypt.compare(password, account.password);
      isMatch = await argon2.verify(account.password,password)
    } catch (e) {
      isMatch = false;
    }

    // bcrypt(ハッシュ化されたやつ)で一致しなかった場合 → 平文として比較してみる
    if (!isMatch && account.password === password) {
      // 平文で保存されていたので、ハッシュ化して更新
      //const saltRounds = 10;
      //const hashedPassword = await bcrypt.hash(password, saltRounds);
      //account.password = hashedPassword;
      account.password = await argon2.hash(password);
      await account.save();
      isMatch = true;
    }

    if (!isMatch) {
      res.status(401).json({ success: false, message: 'Wrong password.\nお前ニセモンやろ' });
      return;
    }

    // JWTトークン生成
    const token = jwt.sign({ aid: account.accountId }, app.get('superSecret'), {
      expiresIn: '24h'
    });

    // トークンを保存して更新
    account.token = token;
    await account.save();

    // 成功レスポンス（パスワードは返さない）
    res.status(200).json({
      success: true,
      message: 'Authentication successful.\nログイン成功',
      account: {
        accountId: account.accountId,
        name: account.name,
        icon: account.icon,
        token: account.token
      }
    });

  } catch (err: any) {
    res.status(500).json({ success: false,  message: 'エラー\n ' + err.message });
  }
});

/**
 * [アカウントのパスワードリセット要求API]
 * POST http://localhost:3000/accounts/request-password-reset
 * パスワードリセット要求を受け付けます
 */
app.post('/accounts/request-password-reset', async (req, res) => {
  try {
    const { email } = req.body;

    // 受け取った場合のサンプルコード
    // メール送信のサンプルコードはコメントアウトしています
    /*
    // アカウントをメールアドレスで検索
    const account = await accountsResource.findOne({ email });
    if (!account) {
      res.status(404).json({ success: false, message: 'Account not found.' });
      return;
    }
    // パスワードリセット用のトークンを生成（有効期限1時間）
    const resetToken = jwt.sign({ aid: account.accountId }, app.get('superSecret'),
    {
      expiresIn: '1h'
    });

    // メール送信（nodemailerなどを使用）
    // 例: await sendPasswordResetEmail(email, resetToken);
    */

    // 実際にはメールを送信するが、ここでは常に成功レスポンスを返す
    res.status(200).json({
      success: true,
      message: 'If the email is registered, a password reset link has been sent.\nえ？パスワード変更したいの？Discordで連絡して()'
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

//--------------------------
// ランキング関連API
//--------------------------
/**
 * [ランキング取得API]
 * 指定した譜面のランキングを取得します
 * GET http://localhost:3000/ranking?chartHash=xxxx&difficulty=1
 */
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

    const query = {
      chartHash: String(chartHash).trim(),
      difficulty: Number(difficulty),
    };

    const ranking = await rankingResource.aggregate([
      // 対象の譜面のスコアを絞り込み
      { $match: query },

      // スコア降順 → abCount降順
      { $sort: { score: -1, abCount: -1 } },

      // アカウント情報を結合
      {
        $lookup: {
          from: "accounts",         // コレクション名（モデル名の複数形）
          localField: "accountId",  // ranking のフィールド
          foreignField: "accountId",// accounts のフィールド
          as: "account"
        }
      },

      // account は配列で入るので展開
      { $unwind: { path: "$account", preserveNullAndEmptyArrays: true } },

      // banned が true のものを除外（カラムが無い or false は許可）
      {
        $match: {
          $or: [
            { "account.banned": { $exists: false } },
            { "account.banned": false }
          ]
        }
      },

      // 必要なフィールドだけ返す
      {
        $project: {
          _id: 0,
          score: 1,
          abCount: 1,
          date: 1,
          "account.name": 1,
          "account.icon": 1
        }
      },

      // 上位200件に制限
      { $limit: 200 }
    ]);

    res.status(200).json({ ranking: ranking });
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
      res.status(400).json({ error: "songTitle, chartHash, accountId, accountToken, score, and maxScore are required" });
      return;
    }

    // トークンの検証とアカウントのバンチェック
    accountsResource.findOne({ accountId }).then(account => {
      if (!account || account.token !== accountToken) {
        return res.status(403).json({ error: "Your account login token is invalid トークンが無効です。" });
      }

      if (account.banned) {
        return res.status(403).json({ error: "You cannot perform this action because your account is banned. お前はもうBANされている。" });
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

//--------------------------
// サーバー起動
//--------------------------

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
