import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = path.join(__dirname, 'profiles');
const DIST_DIR = path.join(__dirname, 'dist');
const SHARED_DIR = path.join(__dirname, 'shared');
const MAIN_URL = 'https://orderhangtaobao.com/';
const SITE_YEAR = new Date().getFullYear();

const IMAGE_MAP = {
  'https://photo2.tinhte.vn/data/attachment-files/2026/11/9127717_01-dich-vu-mua-ho-taobao.jpg':
    '01-dich-vu-mua-ho-taobao.jpg',
  'https://photo2.tinhte.vn/data/attachment-files/2026/11/9127718_02-nguon-hang-1688.jpg':
    '02-nguon-hang-1688.jpg',
  'https://photo2.tinhte.vn/data/attachment-files/2026/11/9127719_03-chi-phi-van-chuyen.jpg':
    '03-chi-phi-van-chuyen.jpg',
  'https://photo2.tinhte.vn/data/attachment-files/2026/11/9127720_04-dich-vu-nhap-hang-trung-quoc.jpg':
    '04-dich-vu-nhap-hang-trung-quoc.jpg',
  'https://orderhangtaobao.com/wp-content/uploads/2026/09/dich-vu-mua-ho-taobao-2-1.jpg':
    '01-dich-vu-mua-ho-taobao.jpg',
  'https://orderhangtaobao.com/wp-content/uploads/2026/09/Order-1688-Nguon-hang-Trung-Quoc-gia-tot-cho-cac-chu-shop-1.jpg':
    '02-nguon-hang-1688.jpg',
  'https://orderhangtaobao.com/wp-content/uploads/2026/09/Cach-tinh-phi-van-chuyen-Taobao-ve-Viet-Nam-1.jpg':
    '03-chi-phi-van-chuyen.jpg',
  'https://orderhangtaobao.com/wp-content/uploads/2022/01/banner4-1.jpg':
    '04-dich-vu-nhap-hang-trung-quoc.jpg',
};

marked.setOptions({ gfm: true, breaks: false });

const esc = (value = '') =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]),
  );

const plain = (markdown = '') =>
  markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const truncate = (text, max) => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).trim()}…`;
};

const formatDate = (isoDate) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const isoOrFallback = (value, fallback = '2026-11-04') => {
  const raw = String(value || fallback);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
};

function loadArticles(profileDir) {
  const contentDir = path.join(profileDir, 'content');
  if (!fs.existsSync(contentDir)) return [];

  const articles = fs
    .readdirSync(contentDir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => {
      const raw = fs.readFileSync(path.join(contentDir, file), 'utf8');
      const parsed = matter(raw);
      const content = parsed.content.replace(/^\uFEFF/, '').trim();
      const heading = content.match(/^#\s+([^\n]+)/);
      const body = content.replace(/^\s*#\s+[^\n]*\n/, '').trim();
      const slug = String(parsed.data.slug || file.replace(/\.md$/, ''));
      const date = isoOrFallback(parsed.data.date);
      const words = plain(body).split(/\s+/).filter(Boolean).length;
      return {
        slug,
        title: String(parsed.data.title || (heading ? heading[1].trim() : slug)),
        description: String(
          parsed.data.description || parsed.data.meta_description || truncate(plain(body), 160),
        ),
        date,
        updated: isoOrFallback(parsed.data.updated, date),
        body,
        words,
        minutes: Math.max(1, Math.round(words / 200)),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const seen = new Set();
  for (const article of articles) {
    if (seen.has(article.slug)) {
      throw new Error(`Trùng slug "${article.slug}" trong ${contentDir}`);
    }
    seen.add(article.slug);
  }
  return articles;
}

function firstImage(markdown) {
  const match = markdown.match(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
  if (!match) return null;
  const src = match[1];
  if (IMAGE_MAP[src]) return { local: IMAGE_MAP[src] };
  if (src.startsWith('assets/img/')) return { local: src.slice('assets/img/'.length) };
  if (/^https?:\/\//.test(src)) return { external: src };
  return null;
}

function ogImageFor(config, article) {
  const found = firstImage(article.body);
  if (!found) return config.baseUrl + 'assets/img/logo.jpg';
  if (found.external) return found.external;
  return config.baseUrl + 'assets/img/' + found.local;
}

function fixHtml(html, prefix) {
  let output = html;
  for (const [url, file] of Object.entries(IMAGE_MAP)) {
    output = output.split(url).join(`${prefix}assets/img/${file}`);
  }
  output = output.replace(/(\s(?:src|href))="assets\//g, `$1="${prefix}assets/`);
  return output;
}

function layout({
  config,
  title,
  description,
  canonical,
  prefix,
  ogImage,
  jsonLd,
  noindex,
  ogType = 'website',
  publishedTime,
  body,
}) {
  const fullTitle =
    title === config.siteName ? `${config.siteName} – ${config.tagline}` : `${title} – ${config.siteName}`;
  const theme = config.theme;
  const jsonLdSafe = jsonLd ? JSON.stringify(jsonLd).replace(/</g, '\\u003c') : '';
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(fullTitle)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta name="robots" content="${noindex ? 'noindex,follow' : 'index,follow'}">
  <meta name="theme-color" content="${esc(theme.primary)}">
  <meta property="og:type" content="${esc(ogType)}">
  <meta property="og:site_name" content="${esc(config.siteName)}">
  ${publishedTime ? `<meta property="article:published_time" content="${esc(publishedTime)}">` : ''}
  <meta property="og:title" content="${esc(fullTitle)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:locale" content="vi_VN">
  ${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
  <meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
  <link rel="icon" href="${prefix}assets/favicon.svg" type="image/svg+xml">
  <link rel="alternate" type="application/rss+xml" title="${esc(config.siteName)}" href="${prefix}feed.xml">
  <link rel="stylesheet" href="${prefix}assets/style.css">
  <style>:root{--primary:${theme.primary};--primary-dark:${theme.primaryDark};--accent:${theme.accent}}</style>
  ${jsonLdSafe ? `<script type="application/ld+json">${jsonLdSafe}</script>` : ''}
</head>
<body>
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="${prefix}">
        <img class="brand-logo" src="${prefix}assets/img/logo.jpg" alt="Logo ${esc(config.siteName)}" width="40" height="40">
        <span class="brand-name">${esc(config.siteName)}</span>
      </a>
      <nav class="site-nav" aria-label="Điều hướng chính">
        <a href="${prefix}">Trang chủ</a>
        <a href="${prefix}#bai-viet">Bài viết</a>
        <a href="${prefix}gioi-thieu/">Giới thiệu</a>
      </nav>
    </div>
  </header>
  <main id="noi-dung">
${body}
  </main>
  <footer class="site-footer">
    <div class="wrap footer-inner">
      <p><strong>${esc(config.siteName)}</strong> – ${esc(config.tagline)}.</p>
      <p>Trang thông tin về dịch vụ mua hộ và vận chuyển hàng Trung Quốc. Thông tin chính thức tại <a href="${MAIN_URL}" rel="noopener">orderhangtaobao.com</a>.</p>
      <p class="copyright">© ${SITE_YEAR} ${esc(config.siteName)}.</p>
    </div>
  </footer>
</body>
</html>`;
}

function ctaBox(config) {
  return `<aside class="cta-box">
      <h2>${esc(config.ctaBox.title)}</h2>
      <p>${esc(config.ctaBox.text)}</p>
      <a class="btn" href="${esc(config.ctaBox.url)}" rel="noopener">${esc(config.ctaBox.label)}</a>
    </aside>`;
}

function homeBody(config, articles, prefix) {
  const cards = articles
    .map((article) => {
      const image = firstImage(article.body);
      const imageFile = image?.local;
      return `<article class="card">
          ${
            imageFile
              ? `<a class="card-image" href="${prefix}bai-viet/${article.slug}/"><img src="${prefix}assets/img/${imageFile}" alt="" loading="lazy" width="640" height="360"></a>`
              : ''
          }
          <div class="card-body">
            <p class="card-meta">${formatDate(article.date)} · ${article.minutes} phút đọc</p>
            <h3><a href="${prefix}bai-viet/${article.slug}/">${esc(article.title)}</a></h3>
            <p>${esc(article.description)}</p>
            <a class="more" href="${prefix}bai-viet/${article.slug}/">Đọc bài viết →</a>
          </div>
        </article>`;
    })
    .join('\n        ');

  return `    <section class="hero">
      <div class="wrap hero-inner">
        <p class="eyebrow">${esc(config.eyebrow)}</p>
        <h1>${esc(config.heroTitle)}</h1>
        ${config.homeIntro.map((paragraph) => `<p>${esc(paragraph)}</p>`).join('\n        ')}
        <a class="btn" href="${MAIN_URL}" rel="noopener">${esc(config.ctaLabel)}</a>
      </div>
    </section>

    <section class="wrap section" id="bai-viet">
      <h2>Bài viết</h2>
      <div class="cards">
        ${cards}
      </div>
    </section>

    <section class="wrap section about-teaser">
      <h2>Về ${esc(config.siteName)}</h2>
      <p>${esc(config.aboutIntro)}</p>
      <a class="more" href="${prefix}gioi-thieu/">Tìm hiểu thêm →</a>
    </section>

    <section class="cta-band">
      <div class="wrap">
        <h2>${esc(config.ctaBox.title)}</h2>
        <p>${esc(config.ctaBox.text)}</p>
        <a class="btn btn-light" href="${esc(config.ctaBox.url)}" rel="noopener">${esc(config.ctaBox.label)}</a>
      </div>
    </section>`;
}

function articleBody(config, article, articles, prefix) {
  const fixed = fixHtml(marked.parse(article.body), prefix);
  const others = articles.filter((item) => item.slug !== article.slug);
  const otherLinks = others.length
    ? `<section class="related">
        <h2>Bài viết khác</h2>
        <ul>
          ${others
            .map(
              (item) =>
                `<li><a href="${prefix}bai-viet/${item.slug}/">${esc(item.title)}</a></li>`,
            )
            .join('\n          ')}
        </ul>
      </section>`
    : '';

  return `    <article class="wrap post">
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="${prefix}">Trang chủ</a> <span aria-hidden="true">/</span> <span>${esc(article.title)}</span>
      </nav>
      <header class="post-header">
        <h1>${esc(article.title)}</h1>
        <p class="post-meta">${formatDate(article.date)} · ${article.minutes} phút đọc</p>
      </header>
      <div class="post-body">
${fixed}
      </div>
      ${ctaBox(config)}
      ${otherLinks}
    </article>`;
}

function aboutBody(config, prefix) {
  return `    <section class="wrap page">
      <h1>Giới thiệu</h1>
      ${config.about.map((paragraph) => `<p>${esc(paragraph)}</p>`).join('\n      ')}
      <p><a class="btn" href="${MAIN_URL}" rel="noopener">${esc(config.ctaLabel)}</a></p>
    </section>`;
}

function sitemapXml(config, articles) {
  const latest = articles[0]?.date || '2026-11-04';
  const entries = [
    { loc: config.baseUrl, lastmod: latest, priority: '1.0' },
    { loc: `${config.baseUrl}gioi-thieu/`, lastmod: latest, priority: '0.6' },
    ...articles.map((article) => ({
      loc: `${config.baseUrl}bai-viet/${article.slug}/`,
      lastmod: article.updated,
      priority: '0.8',
    })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (entry) =>
      `  <url><loc>${esc(entry.loc)}</loc><lastmod>${entry.lastmod}</lastmod><priority>${entry.priority}</priority></url>`,
  )
  .join('\n')}
</urlset>
`;
}

function feedXml(config, articles) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(config.siteName)}</title>
    <link>${esc(config.baseUrl)}</link>
    <description>${esc(config.description)}</description>
    <language>vi-VN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${articles
  .map(
    (article) => `    <item>
      <title>${esc(article.title)}</title>
      <link>${esc(`${config.baseUrl}bai-viet/${article.slug}/`)}</link>
      <guid>${esc(`${config.baseUrl}bai-viet/${article.slug}/`)}</guid>
      <description>${esc(article.description)}</description>
      <pubDate>${new Date(`${article.date}T00:00:00Z`).toUTCString()}</pubDate>
    </item>`,
  )
  .join('\n')}
  </channel>
</rss>
`;
}

function writeFile(outDir, relativePath, content) {
  const target = path.join(outDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function checkInternalLinks(outDir) {
  const errors = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) inspect(full);
    }
  };

  const inspect = (file) => {
    const html = fs.readFileSync(file, 'utf8');
    const regex = /(?:href|src)="([^"]+)"/g;
    let match;
    while ((match = regex.exec(html))) {
      let target = match[1];
      if (!target || target.startsWith('#') || /^(https?:|mailto:|tel:|data:)/.test(target)) continue;
      target = target.split('#')[0].split('?')[0];
      if (!target) continue;
      const resolved = target.startsWith('/')
        ? path.join(outDir, target)
        : path.resolve(path.dirname(file), target);
      const candidates = [resolved, path.join(resolved, 'index.html')];
      if (!candidates.some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())) {
        errors.push(`${path.relative(outDir, file)} → ${match[1]}`);
      }
    }
  };

  walk(outDir);
  return errors;
}

function buildProfile(profileDir) {
  const configPath = path.join(profileDir, 'config.json');
  if (!fs.existsSync(configPath)) return null;
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!config.baseUrl.endsWith('/')) config.baseUrl += '/';
  const outDir = path.join(DIST_DIR, config.key || path.basename(profileDir));
  const articles = loadArticles(profileDir);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(path.join(SHARED_DIR, 'assets'), path.join(outDir, 'assets'), { recursive: true });

  const homeJsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: config.siteName,
        url: config.baseUrl,
        description: config.description,
        inLanguage: 'vi',
      },
      {
        '@type': 'Organization',
        name: config.siteName,
        url: config.baseUrl,
        logo: `${config.baseUrl}assets/img/logo.jpg`,
        sameAs: [MAIN_URL],
      },
    ],
  };

  writeFile(
    outDir,
    'index.html',
    layout({
      config,
      title: config.siteName,
      description: config.description,
      canonical: config.baseUrl,
      prefix: './',
      ogImage: `${config.baseUrl}assets/img/logo.jpg`,
      jsonLd: homeJsonLd,
      body: homeBody(config, articles, './'),
    }),
  );

  for (const article of articles) {
    const canonical = `${config.baseUrl}bai-viet/${article.slug}/`;
    writeFile(
      outDir,
      `bai-viet/${article.slug}/index.html`,
      layout({
        config,
        title: article.title,
        description: article.description,
        canonical,
        prefix: '../../',
        ogImage: ogImageFor(config, article),
        ogType: 'article',
        publishedTime: article.date,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: article.title,
          description: article.description,
          datePublished: article.date,
          dateModified: article.updated,
          inLanguage: 'vi',
          mainEntityOfPage: canonical,
          image: [ogImageFor(config, article)],
          author: { '@type': 'Organization', name: config.siteName, url: config.baseUrl },
          publisher: {
            '@type': 'Organization',
            name: config.siteName,
            logo: { '@type': 'ImageObject', url: `${config.baseUrl}assets/img/logo.jpg` },
          },
        },
        body: articleBody(config, article, articles, '../../'),
      }),
    );
  }

  writeFile(
    outDir,
    'gioi-thieu/index.html',
    layout({
      config,
      title: 'Giới thiệu',
      description: config.aboutIntro,
      canonical: `${config.baseUrl}gioi-thieu/`,
      prefix: '../',
      ogImage: `${config.baseUrl}assets/img/logo.jpg`,
      body: aboutBody(config, '../'),
    }),
  );

  writeFile(
    outDir,
    '404.html',
    layout({
      config,
      title: 'Không tìm thấy trang',
      description: 'Trang bạn tìm không tồn tại.',
      canonical: config.baseUrl,
      prefix: '/',
      noindex: true,
      body: `    <section class="wrap page">
      <h1>Không tìm thấy trang</h1>
      <p>Đường dẫn này không tồn tại hoặc đã được thay đổi.</p>
      <p><a class="btn" href="${config.baseUrl}">Về trang chủ</a></p>
    </section>`,
    }),
  );

  writeFile(outDir, 'robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${config.baseUrl}sitemap.xml\n`);
  writeFile(outDir, 'sitemap.xml', sitemapXml(config, articles));
  writeFile(outDir, 'feed.xml', feedXml(config, articles));
  writeFile(
    outDir,
    '_headers',
    `/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`,
  );
  writeFile(outDir, '.nojekyll', '');

  const linkErrors = checkInternalLinks(outDir);
  if (linkErrors.length) {
    throw new Error(`Liên kết nội bộ lỗi ở ${config.key}:\n${linkErrors.join('\n')}`);
  }

  return { key: config.key, outDir, articles: articles.length, baseUrl: config.baseUrl };
}

const results = [];
for (const entry of fs.readdirSync(PROFILES_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const result = buildProfile(path.join(PROFILES_DIR, entry.name));
  if (result) results.push(result);
}

for (const result of results) {
  const placeholder = result.baseUrl.includes('USERNAME') ? '  [cần cập nhật baseUrl]' : '';
  console.log(
    `✓ ${result.key}: ${result.articles} bài viết → ${path.relative(__dirname, result.outDir)}${placeholder}`,
  );
}
