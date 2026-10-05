const label = value => value.replace(/[!-/:-@[-`{-~]/g, '\\$&').replace(/\r\n?|\n/g, ' ');
const destination = value => `<${value.replace(/[<>\\\s]/g, character => encodeURIComponent(character))}>`;
const link = (text, url) => `[${label(text)}](${destination(url)})`;
const quote = markdown => markdown.split('\n').map(line => `> ${line}`).join('\n');
const hasTitle = article => typeof article?.title === 'string' && article.title.trim().length > 0;
const attribution = record => `作者：${link(`@${record.author.login}`, `https://github.com/${encodeURIComponent(record.author.login)}`)}`;

export function buildReviewPullRequest(record, { articles = {}, parent } = {}) {
  const configured = Object.hasOwn(articles, record.blog_id) ? articles[record.blog_id] : undefined;
  const article = hasTitle(configured) ? configured : (hasTitle(record.article) ? record.article : { title: record.blog_id });
  const prefix = `评论：《`, suffix = '》';
  const limit = 256 - Array.from(prefix + suffix).length;
  const name = Array.from(article.title.replace(/\r\n?|\n/g, ' '));
  const title = prefix + (name.length > limit ? name.slice(0, limit - 1).join('') + '…' : name.join('')) + suffix;
  const sections = [
    `文章：${article.url ? link(article.title, article.url) : label(article.title)}`,
    `路径：${label(record.blog_id)}`,
    attribution(record),
  ];
  if (record.reply_to !== null) {
    if (!parent || parent.id !== record.reply_to || parent.blog_id !== record.blog_id) throw new Error('Review reply context must match the approved parent');
    sections.push(`### 回复的评论\n\n${attribution(parent)}\n\n${quote(parent.body_markdown)}`);
  }
  sections.push(`### 评论正文\n\n${quote(record.body_markdown)}`);
  return { title, body: sections.join('\n\n') + '\n' };
}
