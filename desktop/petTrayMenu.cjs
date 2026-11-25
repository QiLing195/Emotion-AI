function buildPetTrayMenuTemplate(actions) {
  return [
    { label: '显示桌宠', click: actions.focusPet },
    { label: '重载桌宠界面', click: actions.reloadPet },
    { type: 'separator' },
    { label: '打开聊天窗口', click: actions.openChat },
    { label: '唤醒词设置…', click: actions.openVoiceSettings },
    { type: 'separator' },
    { label: '退出桌宠', click: actions.quit },
  ];
}

module.exports = { buildPetTrayMenuTemplate };
