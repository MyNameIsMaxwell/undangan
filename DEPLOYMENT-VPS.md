# Деплой на VPS (Beget + домен)

## VPS

- **Публичный IP сервера:** `109.172.46.83`
- Проект на сервере (пример): `/var/www/undangan`
- Node через **PM2**, имя процесса: `wedding`
- **Nginx** проксирует порт **80** → `127.0.0.1:3000`

## Ответ техподдержки Beget

> Вам необходимо направить домен на ваш сервер. Для этого в разделе DNS  
> (https://cp.beget.com/dns) укажите в А-записи IP-адрес вашего сервера.  
> **Необходимо оставить только А-запись с IP-адресом VPS.**

Раздел панели: [Управление DNS](https://cp.beget.com/dns).

## Состояние DNS (на момент сохранения)

Домен: **maxjuliawedding.ru**

| Имя | Тип | Значение | Заметка |
|-----|-----|----------|---------|
| `maxjuliawedding.ru` (корень) | A | `109.172.46.83` | Совпадает с IP VPS — верно. |
| `www.maxjuliawedding.ru` | A | `5.101.152.161` | **Не совпадает с VPS.** Для единого сайта на VPS нужно заменить на **`109.172.46.83`**. |
| `autoconfig` | CNAME | `autoconfig.beget.com` | Почта / автонастройка клиентов. |
| `autodiscover` | CNAME | `autodiscover...` (Beget) | Аналогично. |
| `www` | MX | `mx1.beget.com`, `mx2.beget.com` | Почта на поддомене www (редкая схема). |
| зона | TXT (SPF) | `v=spf1 redirect=beget.com` | Для исходящей почты с домена Beget. |

Фраза поддержки «оставить только A на VPS» может означать минимум для **веб-сайта**: главное — чтобы **и корень, и `www`** указывали на ваш сервер, если вы открываете сайт с обоих адресов. Записи **MX / почта** при необходимости уточняйте у поддержки: при удалении MX перестанет работать приём почты на домене через Beget.

## Проверки с сервера или ПК

```bash
dig +short maxjuliawedding.ru A
dig +short www.maxjuliawedding.ru A
```

Ожидаемо для вашего сценария: оба ответа **`109.172.46.83`**.

```bash
curl -sI -H "Host: maxjuliawedding.ru" http://127.0.0.1/
```

На VPS — проверка, что nginx отдаёт сайт.

## Краткий чеклист после правок DNS

1. Исправить **A для `www`** на `109.172.46.83`, если сайт должен открываться с `www`.
2. Подождать обновления DNS (от минут до нескольких часов).
3. Убедиться, что **PM2** (`wedding`) и **nginx** запущены.
4. Открыть: `http://maxjuliawedding.ru` и `http://maxjuliawedding.ru/dashboard`.

## Данные приложения

База SQLite: файл **`database.sqlite`** в каталоге приложения на VPS — делайте резервные копии.

## HTTPS (Let’s Encrypt)

Сайт на Node за nginx: сертификат ставится **на nginx** (порты 443 / редирект с 80), приложение на `127.0.0.1:3000` не меняется.

### Шаг 0. Куда реально попадает домен

На VPS выполните:

```bash
curl -sI http://127.0.0.1/.well-known/acme-challenge/test -H "Host: maxjuliawedding.ru"
curl -sI http://maxjuliawedding.ru/.well-known/acme-challenge/test
```

- Если **первый** ответ — `404` от **nginx/1.x (Ubuntu)**, а **второй** — `500` и заголовок вроде **`nginx-reuseport`**, запросы с интернета идут **не на ваш nginx** (фронт Beget). Тогда **HTTP-01** (`certbot --nginx`) с VPS обычно **не сработает** — используйте **DNS-01** (ниже) или спросите поддержку Beget про SSL / проброс `/.well-known/`.
- Если **оба** ответа согласованы и challenge доходит до вашего nginx — пробуйте **вариант A**.

Установка: `sudo apt install -y certbot python3-certbot-nginx`.

### Вариант A — плагин nginx (HTTP-01)

В конфиге сайта для порта **80** должен быть `proxy_pass` на Node и отдельный `location` для challenge **без** прокси (как в инструкции ранее), либо certbot сам допишет.

```bash
sudo certbot --nginx -d maxjuliawedding.ru -d www.maxjuliawedding.ru
```

Дальше certbot добавит `listen 443 ssl` и обновит конфиг. Проверка автообновления:

```bash
sudo certbot renew --dry-run
```

### Вариант B — только сертификат по DNS (DNS-01), без HTTP

Подходит, если порт 80 / challenge перехватывается хостингом.

```bash
sudo certbot certonly --manual --preferred-challenges dns \
  -d maxjuliawedding.ru -d www.maxjuliawedding.ru
```

Certbot выведет **имя** и **значение** TXT-записи `_acme-challenge` — добавьте их в DNS у регистратора / Beget, подождите распространения (`dig TXT _acme-challenge.maxjuliawedding.ru`), нажмите Enter в терминале.

Сертификаты окажутся в:

`/etc/letsencrypt/live/maxjuliawedding.ru/fullchain.pem`  
`/etc/letsencrypt/live/maxjuliawedding.ru/privkey.pem`

Подключите их в nginx (замените путь к `include`, если файлов ещё нет — один раз выполните успешный `certbot` по любому методу или смотрите [документацию certbot](https://eff-certbot.readthedocs.io)):

```nginx
server {
    listen 443 ssl http2;
    server_name maxjuliawedding.ru www.maxjuliawedding.ru;

    ssl_certificate     /etc/letsencrypt/live/maxjuliawedding.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/maxjuliawedding.ru/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name maxjuliawedding.ru www.maxjuliawedding.ru;
    return 301 https://$host$request_uri;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo ufw allow 'Nginx Full'
```

Обновление сертификата по DNS вручную каждые ~90 дней неудобно; для автоматизации нужен **API DNS** регистратора и плагин certbot (например Cloudflare) — смотрите `certbot plugins` и документацию своего DNS.

### После включения HTTPS

Фронтенд уже работает с относительными URL; при прокси с заголовком `X-Forwarded-Proto: https` схема для приложения корректна. Админку открывайте как `https://ваш-домен/dashboard`.

## Скорость загрузки и фото

Исходные JPEG из зеркалки часто весят **10–20 МБ** каждый — так страница легко тянет **100+ МБ** и грузится десятки секунд.

Рекомендации:

1. **Сжать и уменьшить** кадры под веб: длинная сторона **1920 px** (для фона) или **1600 px**, качество **75–85%**, формат **WebP** или оптимизированный JPEG. Инструменты: [Squoosh](https://squoosh.app/), XnConvert, `sharp` в CLI.
2. В шаблоне для картинок с **`data-src`** используется **прозрачный placeholder** в `src`, чтобы файл не качался **дважды** (браузер + скрипт кэша).
3. Кадрирование фона на узкой колонке настраивается в **`css/guest.css`**: свойства **`object-position`** у класса **`.bg-cover-home`** (при необходимости подправьте проценты под ваши кадры).

Если после сжатия фото всё ещё тяжёлые — проверьте в DevTools → Network суммарный объём и самые большие файлы.
