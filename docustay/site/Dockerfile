# The Docustay marketing site: plain files behind nginx. No build step, no scripts, no tracking.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY *.html style.css /usr/share/nginx/html/
