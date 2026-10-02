const notice = document.querySelector('#download-notice');
if (notice) {
  let hideTimer;
  document.querySelectorAll('a[download]').forEach(link => {
    link.addEventListener('click', () => {
      notice.hidden = false;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { notice.hidden = true; }, 15000);
    });
  });
  notice.querySelector('[data-dismiss-download]').addEventListener('click', () => {
    clearTimeout(hideTimer);
    notice.hidden = true;
  });
}
