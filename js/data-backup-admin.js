(function () {
  const backup = BremStorage.dataBackup;
  if (!backup) return;

  const statusEl = document.getElementById('backupStatusPanel');
  const importModeEl = document.getElementById('backupImportMode');
  const importGroupEl = document.getElementById('backupImportGroup');
  const importFileEl = document.getElementById('backupImportFile');
  const importResultEl = document.getElementById('backupImportResult');
  const supabaseUrlInput = document.getElementById('supabaseUrlInput');
  const supabaseAnonKeyInput = document.getElementById('supabaseAnonKeyInput');
  const supabaseMigrateResultEl = document.getElementById('supabaseMigrateResult');
  const isProduction = () => BremStorage.getSupabaseConfig?.().mode === 'production';

  function getSupabaseConfigFromForm() {
    const preset = window.BREM_SUPABASE_CONFIG || {};
    return {
      url: supabaseUrlInput?.value?.trim() || preset.url || '',
      anonKey: supabaseAnonKeyInput?.value?.trim() || preset.anonKey || '',
      backend: preset.backend || 'local'
    };
  }

  function isSupabaseConfigured(config) {
    return Boolean(config?.url && config?.anonKey);
  }

  function prefillSupabaseForm() {
    const preset = window.BREM_SUPABASE_CONFIG || {};
    if (supabaseUrlInput && preset.url) supabaseUrlInput.value = preset.url;
    if (supabaseAnonKeyInput && preset.anonKey) supabaseAnonKeyInput.placeholder = '설정됨 (변경 시 입력)';
  }

  function applyProductionUi() {
    const localBtn = document.getElementById('supabaseLocalBtn');
    const connectBtn = document.getElementById('supabaseConnectBtn');
    if (localBtn) localBtn.hidden = isProduction();
    if (connectBtn) connectBtn.hidden = isProduction();
  }

  function createSupabaseClient() {
    const config = getSupabaseConfigFromForm();
    if (!config.url || !config.anonKey) {
      throw new Error('Supabase URL과 anon key를 입력하세요.');
    }
    if (!window.supabase?.createClient) {
      throw new Error('Supabase SDK가 로드되지 않았습니다.');
    }
    return window.supabase.createClient(config.url, config.anonKey);
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderStatus() {
    if (!statusEl) return;
    const status = backup.getStatus();
    const storageStatus = BremStorage.getStorageStatus?.() || {};
    const dbLabel = storageStatus.dbConnectionLabel || storageStatus.backend || 'local';
    const groupRows = Object.values(backup.DATA_GROUPS).map(group => {
      const info = status.groups[group.id];
      return `
        <tr>
          <td>${escapeHtml(group.label)}</td>
          <td>${escapeHtml(group.description)}</td>
          <td>${info.storedKeys}/${info.totalKeys}</td>
        </tr>
      `;
    }).join('');

    statusEl.innerHTML = `
      <div class="backup-status-grid">
        <article class="backup-status-card">
          <span>데이터 스키마 버전</span>
          <strong>${status.schemaVersion} / ${status.currentSchemaVersion}</strong>
        </article>
        <article class="backup-status-card">
          <span>DB 연결 상태</span>
          <strong>${escapeHtml(isProduction() && storageStatus.supabaseHydrated ? 'Supabase Connected' : dbLabel)}</strong>
        </article>
        <article class="backup-status-card">
          <span>Supabase 설정</span>
          <strong>${BremStorage.getSupabaseConfig?.().isConfigured ? '완료' : '미설정'}</strong>
        </article>
        <article class="backup-status-card">
          <span>저장 키 수</span>
          <strong>${status.bremKeyCount}개</strong>
        </article>
      </div>
      <div class="table-wrap">
        <table class="backup-status-table">
          <thead>
            <tr>
              <th>그룹</th>
              <th>설명</th>
              <th>저장된 키</th>
            </tr>
          </thead>
          <tbody>${groupRows}</tbody>
        </table>
      </div>
      <p class="form-help">${isProduction()
        ? '운영 환경에서는 모든 데이터가 Supabase에 저장됩니다. localStorage는 이전 버튼에서만 읽습니다.'
        : '개발 환경에서는 localStorage 또는 Supabase를 선택할 수 있습니다.'}</p>
    `;
  }

  function exportGroup(groupId) {
    try {
      const payload = backup.exportGroup(groupId);
      const keyCount = Object.keys(payload.data).length;
      if (!keyCount) {
        showToast('내보낼 저장 데이터가 없습니다.');
        return;
      }
      backup.downloadJson(payload, backup.buildFilename(groupId));
      showToast(`${backup.DATA_GROUPS[groupId].label} JSON 내보내기 완료 (${keyCount}개 키)`);
    } catch (error) {
      showToast(error.message || '내보내기에 실패했습니다.');
    }
  }

  function readJsonFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(String(reader.result || '')));
        } catch (error) {
          reject(new Error('JSON 파일을 읽을 수 없습니다.'));
        }
      };
      reader.onerror = () => reject(new Error('파일을 열 수 없습니다.'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  async function importFromFile() {
    const file = importFileEl?.files?.[0];
    if (!file) {
      showToast('가져올 JSON 파일을 선택하세요.');
      return;
    }

    const mode = importModeEl?.value || 'merge';
    const groupId = importGroupEl?.value || '';
    const modeLabel = mode === 'replace' ? '덮어쓰기' : '병합';

    if (mode === 'replace') {
      const ok = window.confirm(
        `${modeLabel} 복원을 진행할까요?\n선택한 그룹의 기존 데이터가 백업 파일 값으로 교체됩니다.\n(다른 그룹 데이터는 유지됩니다.)`
      );
      if (!ok) return;
    }

    try {
      const payload = await readJsonFile(file);
      const result = backup.importPayload(payload, {
        mode,
        groupId: groupId || null
      });
      await BremStorage.flushStorage?.();
      renderStatus();
      if (importResultEl) {
        importResultEl.hidden = false;
        importResultEl.innerHTML = `
          <strong>복원 완료</strong>
          <span>그룹: ${escapeHtml(payload.groupLabel || payload.group || '-')}</span>
          <span>모드: ${escapeHtml(modeLabel)}</span>
          <span>적용 키 ${result.importedKeys.length}개</span>
          ${result.skippedKeys.length ? `<span>건너뜀 ${result.skippedKeys.length}개</span>` : ''}
        `;
      }
      showToast(`데이터 복원 완료 (${result.importedKeys.length}개 키)`);
      if (importFileEl) importFileEl.value = '';
    } catch (error) {
      showToast(error.message || '복원에 실패했습니다.');
    }
  }

  async function migrateToSupabase() {
    if (!window.confirm('localStorage 데이터를 Supabase로 이전할까요?\n기존 Supabase 동일 ID 데이터는 upsert로 갱신됩니다.')) return;
    try {
      const client = createSupabaseClient();
      const result = await BremStorage.migrateLocalStorageToSupabase(client);
      await BremStorage.initStorage({ backend: 'supabase' });
      await BremStorage.flushStorage?.();
      if (supabaseMigrateResultEl) {
        supabaseMigrateResultEl.hidden = false;
        const r = result.report;
        supabaseMigrateResultEl.innerHTML = `
          <strong>Supabase 이전 완료</strong>
          <span>기사 ${r.riders} · 공지 ${r.notices} · 프로모션 ${r.promotions}</span>
          <span>관리자 설정/기타 백업 ${r.settings}</span>
        `;
      }
      showToast('Supabase 이전이 완료되었습니다.');
      renderStatus();
    } catch (error) {
      showToast(error.message || 'Supabase 이전에 실패했습니다.');
    }
  }

  async function connectSupabaseMode() {
    try {
      const config = getSupabaseConfigFromForm();
      if (!isSupabaseConfigured(config)) {
        throw new Error('Supabase URL과 anon key를 js/supabase-config.js 또는 화면 입력란에 설정하세요.');
      }
      await BremStorage.initStorage({ backend: 'supabase', config });
      if (window.BREM_SUPABASE_CONFIG) {
        window.BREM_SUPABASE_CONFIG.backend = 'supabase';
      }
      const status = BremStorage.getStorageStatus?.();
      if (status?.backend !== 'supabase') {
        throw new Error(status?.supabaseError || 'Supabase 연결에 실패했습니다.');
      }
      showToast('Supabase에 연결되었습니다.');
      renderStatus();
    } catch (error) {
      showToast(error.message || 'Supabase 연결에 실패했습니다.');
    }
  }

  function connectLocalMode() {
    if (isProduction()) {
      showToast('운영 모드에서는 Supabase만 사용할 수 있습니다.');
      renderStatus();
      return;
    }
    BremStorage.useLocalStorageAdapter();
    if (window.BREM_SUPABASE_CONFIG) window.BREM_SUPABASE_CONFIG.backend = 'local';
    showToast('localStorage 모드로 전환했습니다.');
    renderStatus();
  }

  async function restorePreferredBackend() {
    if (isProduction()) return;
    const config = getSupabaseConfigFromForm();
    const preference = BremStorage.getStorageBackendPreference?.() || 'local';
    if (preference !== 'supabase' || !isSupabaseConfigured(config)) return;
    try {
      await BremStorage.initStorage({ backend: 'supabase', config });
    } catch (error) {
      console.warn('[BREM] Supabase auto-connect skipped:', error.message);
    }
  }

  function bindExportButtons() {
    document.querySelectorAll('[data-backup-export]').forEach(button => {
      button.addEventListener('click', () => exportGroup(button.dataset.backupExport));
    });
  }

  async function init() {
    prefillSupabaseForm();
    applyProductionUi();
    await restorePreferredBackend();
    renderStatus();
    bindExportButtons();
    document.getElementById('backupRefreshStatusBtn')?.addEventListener('click', renderStatus);
    document.getElementById('backupImportBtn')?.addEventListener('click', importFromFile);
    document.getElementById('supabaseMigrateBtn')?.addEventListener('click', migrateToSupabase);
    document.getElementById('supabaseConnectBtn')?.addEventListener('click', connectSupabaseMode);
    document.getElementById('supabaseLocalBtn')?.addEventListener('click', connectLocalMode);
    document.addEventListener('brem-storage-ready', renderStatus);
    document.addEventListener('brem-storage-error', renderStatus);
  }

  document.addEventListener('DOMContentLoaded', init);
  window.BremDataBackupAdmin = { refresh: renderStatus };
})();
