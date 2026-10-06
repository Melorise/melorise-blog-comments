# 0721c 评论仓库

网站上的评论按钮会打开预填的 GitHub Issue。投稿工作流把 Issue 转为审核 PR；维护者合并后，发布工作流生成网站读取的索引。

## 分支和文件

| 分支 | 内容 |
| --- | --- |
| `main` | 配置、Issue 设置、工作流和 `.0721c/runtime/` 运行文件 |
| `comments` | 已审核评论，路径为 `<文章 ID>/comments-<Issue 编号>.json` |
| `index` | 文章评论树，路径为 `<文章 ID>.json` |

文章 ID 来自文章 URL 路径，例如 `article/essay/hello`。

## 首次设置

本地初始化后，在 GitHub 创建空的公开仓库，并上传三个分支：

```sh
git remote add origin git@github.com:OWNER/REPO.git
git push -u origin main
git push origin comments index
```

也可以使用 HTTPS origin。随后设置：

1. 默认分支为 `main`，启用 Issues。
2. **Settings → Actions → General** 中允许仓库工作流运行。
3. **Workflow permissions** 中启用 **Allow GitHub Actions to create and approve pull requests**。
4. 为 `index` 配置分支规则时，允许发布工作流强制更新该分支。

工作流默认使用 `GITHUB_TOKEN`。如果需要专用凭据，在 GitHub 创建仅针对本仓库的 fine-grained Token，授予 `Contents`、`Issues`、`Pull requests` 和 `Commit statuses` 读写权限，再将其保存为 Actions repository secret `COMMENTS_TOKEN`。

网站接入时，将评论仓库配置为 `OWNER/REPO`。

## 审核

打开目标为 `comments` 的评论 PR，阅读文章信息、作者、正文和回复上下文，并确认 `0721c/comment-data` 检查通过。接受评论时合并，拒绝时关闭 PR。

Issue 在转换成功时关闭；评论在合并和索引发布后显示。

## 配置

`config/settings.json` 设置文章投稿策略、正文上限和回复深度。`config/articles.json` 可设置单篇文章是否接受投稿，并提供审核显示的标题和链接。

- `mode: "open"`：开放文章投稿。
- `mode: "allowlist"`：仅接受 `articles.json` 中列出的文章。
- `enabled: false` 或 `disabledIds`：停止某篇文章投稿，保留已有评论。

## 维护

修改或删除评论时，操作 `comments` 分支的 JSON 记录。删除父评论时需一并删除后代，或调整回复的 `reply_to`。

发布会在记录或配置更新后重建整个 `index` 分支。需要重试时，在 **Actions → 0721c publish index → Run workflow** 中选择 `main` 执行。

其他手动工作流：

- `0721c intake comment`：填写 `issue_number` 重试转换。
- `0721c validate comment`：填写 `pr_number` 重新检查审核 PR。

## 检查和更新

在本地执行：

```sh
npx 0721c doctor --repository OWNER/REPO
npx 0721c upgrade --directory /path/to/comments-repository
npx 0721c upgrade --directory /path/to/comments-repository --apply
```

更新前切换到本地 `main`。默认预览，`--apply` 应用文件变更；检查 `git diff` 后提交并推送。完整接入与维护说明见 0721c 安装包的 `docs/`。


## 可选邮件通知

在 `config/settings.json` 添加网站地址和发件设置：

```json
{
  "site": { "url": "https://blog.example", "name": "我的博客" },
  "notifications": {
    "enabled": true,
    "from": "博客评论 <comments@example.com>",
    "notifyOwner": true,
    "notifyReplies": true
  }
}
```

保留已有的其他配置。在 **Settings → Secrets and variables → Actions** 添加 `RESEND_API_KEY`，开启博主通知时还需添加 `COMMENTS_OWNER_EMAIL`。

网站配置要投稿的评论仓库；仓库的 `site.url` 用于生成邮件链接。本地测试可填写 `http://localhost:3000`。

根评论转换为文件、生成审核 PR 后，投稿工作流通知博主，并附带审核链接。回复的 PR 合并、索引发布后，发布工作流通知父评论作者的 GitHub 公开邮箱，未公开邮箱时跳过。发件域名需在 Resend 验证，邮件结果见对应工作流日志和 Resend 控制台。将 `notifications.enabled` 改为 `false` 可关闭。
