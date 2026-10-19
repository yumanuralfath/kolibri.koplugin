local Dispatcher = require("dispatcher")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local Config = require("kolibri_config")
local KolibriUI = require("kolibri_ui")
local Sync = require("kolibri_sync")
local _ = require("gettext")

-- One settings object for the whole process: the file manager and the reader
-- each create their own plugin instance and must not overwrite each other.
local config = Config:new()

local POLL_SECONDS = 60       -- how often pending work is retried while a book is open
local CONNECT_DELAY = 2       -- let DNS/DHCP settle after "network connected"

local Kolibri = WidgetContainer:extend {
    name = "kolibri",
    fullname = _("Kolibri"),
    description = _("Sync reading statistics, progress and highlights to Kolibri."),
}

function Kolibri:init()
    self.config = config
    self.poll_function = function() self:poll() end
    Dispatcher:registerAction("kolibri_sync_now", {
        category = "none",
        event = "KolibriSyncNow",
        title = _("Kolibri: sync now"),
        general = true,
    })
    if self.ui and self.ui.menu then
        self.ui.menu:registerToMainMenu(self)
    end
end

function Kolibri:addToMainMenu(menu_items)
    menu_items.kolibri = {
        text = _("Kolibri"),
        sorting_hint = "tools",
        sub_item_table = KolibriUI.buildMenu(self),
    }
end

-- Poll timer -----------------------------------------------------------------
-- Page turns only set a flag. This timer does the real work, so reading stays
-- fast and an offline device retries as soon as a connection shows up even if
-- the platform never fires a NetworkConnected event.

function Kolibri:schedulePoll()
    UIManager:unschedule(self.poll_function)
    UIManager:scheduleIn(POLL_SECONDS, self.poll_function)
end

function Kolibri:stopPoll()
    UIManager:unschedule(self.poll_function)
end

function Kolibri:poll()
    if self.ui and self.ui.document and config:get("auto_sync") and Sync.hasPendingWork() then
        Sync.request(self.ui, config, "reading")
    end
    if self.ui and self.ui.document then
        self:schedulePoll()
    end
end

-- Events ---------------------------------------------------------------------

function Kolibri:onReaderReady()
    Sync.markActivity()
    self:schedulePoll()
    Sync.request(self.ui, config, "open")
end

function Kolibri:onCloseDocument()
    self:stopPoll()
    Sync.request(self.ui, config, "close", { fast = true })
end

function Kolibri:onCloseWidget()
    self:stopPoll()
end

function Kolibri:onPageUpdate()
    Sync.markActivity()
end

function Kolibri:onPosUpdate()
    Sync.markActivity()
end

function Kolibri:onAnnotationsModified()
    Sync.markActivity()
end

function Kolibri:onBookmarkModified()
    Sync.markActivity()
end

function Kolibri:onBookmarksModified()
    Sync.markActivity()
end

function Kolibri:onHighlightAdded()
    Sync.markActivity()
end

function Kolibri:onNetworkConnected()
    UIManager:scheduleIn(CONNECT_DELAY, function()
        Sync.request(self.ui, config, "connect")
    end)
end

function Kolibri:onResume()
    -- Wi-Fi often survives a suspend without a new NetworkConnected event.
    if Sync.isConnected() then
        UIManager:scheduleIn(5, function()
            Sync.request(self.ui, config, "connect")
        end)
    end
end

function Kolibri:onKolibriSyncNow()
    Sync.request(self.ui, config, "manual")
    return true
end

return Kolibri
