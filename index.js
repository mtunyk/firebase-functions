const functions = require('firebase-functions');
const admin = require('firebase-admin');
const createClient = require('apple-news');
const { renderTemplateFile } = require('template-file');
const serviceAccount = require('./serviceAccountKey.json');

const appleClient = createClient({
  apiId: '0ef49d8c-0306-45af-8d62-a0ce7f12e5af',
  apiSecret: 'UtI2EFdlqe4L+2ePyCNsxMseM0A0APKiRO2GO+5LOPg='
});

const channelId = "8e9ba9c8-5f93-452c-8418-699d263d1e95";

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'http://localhost:9000/?ns=apple-news-backend',
});

const db = admin.database();

exports.publishToAppleNews = functions
  //.runWith({ timeoutSeconds: 120 }) // optionally, 60s by default
  .database.ref('/apple-news-backend/apple_news/{id}')
  .onWrite(async (change, context) => {
    functions.logger.log("Story id" + context.params.id);

    const original = change.after.val();
    functions.logger.log("Title: " + original.title);

    /*  ignore any writes */

    // replace \n\n with paragraphs
    let content = original.content;
    content = '<p>' + content.replace(/\n\n/g, '</p><p>') + '</p>';

    const data = {
      title: original.title,
      stillURL: original.still_url,
      videoURL: original.video_url,
      caption: original.description,
      header: original.title,
      pubTime: original.pub_date,
      body: content,
      thumbnailURL: original.thumbnail_url
    };

    const renderedString = await renderTemplateFile('article.json', data);
    const articleHash = context.params.id;

    const articleMappingsRef = db.ref('/apple-news-backend/apple-news-article-mappings');
    const r = await articleMappingsRef.child(articleHash).once('value');
    const article = r.val();

    if (article) {
      // update the article in Apple News.
      return appleClient.updateArticle({
        articleId: article.id,
        revision: article.revision,
        article: JSON.parse(renderedString),
      }, (err, { id, revision }) => {
        if (err) {
          functions.logger.log(err);
          return -1; // data is undefined if error
        }

        const hashVal = {};
        hashVal[articleHash] = { id, revision };

        return articleMappingsRef.set(hashVal).then(() => {
          functions.logger.log(`Story ${articleHash} updated. ID: ${id}`);
        });
      });
    } else {

      // Publish draft article to Apple News.
      return appleClient.createArticle({
        channelId: channelId,
        article: JSON.parse(renderedString),
        bundleFiles: []
      }, (err, { id, revision }) => {
        if (err) {
          functions.logger.log(err);
          return -1; // data is undefined if error
        }

        const hashVal = {};
        hashVal[articleHash] = { id, revision };

        return articleMappingsRef.set(hashVal).then(() => {
          functions.logger.log(`Story ${articleHash} drafted. ID: ${id}`);
        });
      });
    }
  });
