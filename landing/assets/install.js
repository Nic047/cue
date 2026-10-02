const notice = document.querySelector('#download-notice');
if (notice) {
  document.querySelectorAll('a[download]').forEach(link => {
    link.addEventListener('click', () => {
      notice.hidden = false;
    });
  });
  notice.querySelector('[data-dismiss-download]').addEventListener('click', () => {
    notice.hidden = true;
  });
}
