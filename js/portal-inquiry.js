(function () {
  function showSuccessToast(message) {
    var existing = document.getElementById('inquirySuccessToast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'inquirySuccessToast';
    toast.className = 'inquiry-success-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML = '<strong>전송완료</strong><span>' + message + '</span>';
    document.body.appendChild(toast);

    window.setTimeout(function () {
      toast.classList.add('is-visible');
    }, 10);

    window.setTimeout(function () {
      toast.classList.remove('is-visible');
      window.setTimeout(function () {
        toast.remove();
      }, 300);
    }, 3200);
  }

  function readPayload(form) {
    var formData = new FormData(form);
    return {
      name: formData.get('name'),
      phone: formData.get('phone'),
      area: formData.get('area'),
      inquiryType: formData.get('inquiryType'),
      message: formData.get('message')
    };
  }

  async function submitInquiry(formData) {
    if (window.BremRiderInquiryApi?.ready) {
      await window.BremRiderInquiryApi.ready;
    }
    var payload = {
      name: String(formData.name || '').trim(),
      phone: String(formData.phone || '').trim(),
      area: String(formData.area || '').trim(),
      inquiryType: String(formData.inquiryType || '라이더 지원').trim(),
      message: String(formData.message || '').trim()
    };

    if (!payload.name || !payload.phone || !payload.message) {
      throw new Error('이름, 연락처, 문의 내용은 필수입니다.');
    }

    if (!window.BremRiderInquiryApi?.create) {
      throw new Error('문의 전송 모듈을 불러오지 못했습니다.');
    }

    return window.BremRiderInquiryApi.create(payload);
  }

  async function handleSubmit(form, options) {
    var statusEl = document.getElementById(options.statusId || 'inquiryStatus');
    var submitBtn = form.querySelector('[type="button"]')
      || form.querySelector('[type="submit"]');

    if (submitBtn) submitBtn.disabled = true;

    if (statusEl) {
      statusEl.hidden = false;
      statusEl.className = 'inquiry-status inquiry-status--pending';
      statusEl.textContent = '전송 중입니다...';
    }

    try {
      await submitInquiry(readPayload(form));
      form.reset();
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.className = 'inquiry-status inquiry-status--success';
        statusEl.textContent = '전송완료! 문의가 접수되었습니다. 확인 후 연락드리겠습니다.';
      }
      showSuccessToast('문의가 정상적으로 접수되었습니다.');
    } catch (error) {
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.className = 'inquiry-status inquiry-status--error';
        statusEl.textContent = error.message || '전송에 실패했습니다. 잠시 후 다시 시도해 주세요.';
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function bindForm(formId, options) {
    var form = document.getElementById(formId);
    if (!form) return;

    var opts = options || {};
    var submitBtn = form.querySelector('[type="button"]')
      || form.querySelector('[type="submit"]');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      handleSubmit(form, opts);
    });

    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        handleSubmit(form, opts);
      });
    }
  }

  window.BremPortalInquiry = {
    submitInquiry: submitInquiry,
    bindForm: bindForm
  };

  function init() {
    bindForm('riderInquiryForm');
    bindForm('contactInquiryForm', { statusId: 'contactInquiryStatus' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
