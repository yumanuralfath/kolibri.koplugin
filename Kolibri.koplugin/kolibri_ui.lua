-- Menu, status screen and dialogs.
local ConfirmBox = require("ui/widget/confirmbox")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local TextViewer = require("ui/widget/textviewer")
local UIManager = require("ui/uimanager")
local Client = require("kolibri_client")
local Stats = require("kolibri_stats")
local Sync = require("kolibri_sync")
local _ = require("gettext")

local UI = {}

local INTERVALS = { 5, 10, 15, 30, 60 }
local BATCH_SIZES = { 500, 1500, 3000 }

local TRIGGER_LABEL = {
    manual = _("manual sync"),
    connect = _("network connected"),
    open = _("book opened"),
    close = _("book closed"),
    reading = _("while reading"),
}

function UI.relativeTime(timestamp)
    timestamp = tonumber(timestamp) or 0
    if timestamp <= 0 then return _("never") end
    local delta = os.time() - timestamp
    if delta < 60 then return _("just now") end
    if delta < 3600 then return string.format(_("%d min ago"), math.floor(delta / 60)) end
    if delta < 86400 then return string.format(_("%d h ago"), math.floor(delta / 3600)) end
    return string.format(_("%d days ago"), math.floor(delta / 86400))
end

local function absoluteTime(timestamp)
    return os.date("%d %b %Y, %H:%M", tonumber(timestamp) or 0)
end

local function thousands(number)
    local text = tostring(math.floor(tonumber(number) or 0))
    local result = text:reverse():gsub("(%d%d%d)", "%1,"):reverse()
    return (result:gsub("^,", ""))
end

local function parseError(raw)
    if not raw or raw == "" then return nil end
    local stamp, message = raw:match("^(%d+)|(.*)$")
    return tonumber(stamp), message or raw
end

local function dot(on)
    return on and "●" or "○"
end

--- One-line status shown at the top of the menu.
function UI.statusLine(config)
    if not config:isConfigured() then return _("Not configured") end
    local error_stamp = parseError(config:get("last_error"))
    if error_stamp then
        return string.format(_("Last sync failed %s"), UI.relativeTime(error_stamp))
    end
    if not Sync.isConnected() and Sync.hasPendingWork() then
        return _("Waiting for network")
    end
    local last = config:get("last_success")
    if last and last > 0 then
        return string.format(_("Synced %s"), UI.relativeTime(last))
    end
    return _("Ready, not synced yet")
end

function UI.statusText(config)
    local lines = {}
    local function add(text) lines[#lines + 1] = text end
    local url = config:get("server_url")
    local connected = Sync.isConnected()
    local auto = config:get("auto_sync")

    add(_("CONNECTION"))
    add(string.format("%s  %s", _("Server:"), url ~= "" and Client.normalizeUrl(url) or _("not set")))
    add(string.format("%s  %s", _("Password:"), config:get("password") ~= "" and _("set") or _("not set")))
    add(string.format("%s  %s %s", _("Network:"), dot(connected), connected and _("connected") or _("offline")))
    add("")

    add(_("AUTO SYNC"))
    add(string.format("%s  %s %s", _("Status:"), dot(auto), auto and _("on") or _("off")))
    if auto then
        local triggers = {}
        if config:get("sync_on_connect") then triggers[#triggers + 1] = _("network connects") end
        if config:get("sync_on_open") then triggers[#triggers + 1] = _("book opens") end
        if config:get("sync_while_reading") then triggers[#triggers + 1] = _("while reading") end
        if config:get("sync_on_close") then triggers[#triggers + 1] = _("book closes") end
        add(string.format("%s  %s", _("Triggers:"), #triggers > 0 and table.concat(triggers, ", ") or _("none")))
        add(string.format(_("Minimum interval:  %d min"), config:get("interval_minutes")))
    end
    add("")

    add(_("LAST SYNC"))
    local last = config:get("last_success")
    if last and last > 0 then
        add(string.format("%s  %s (%s)", _("Succeeded:"), UI.relativeTime(last), absoluteTime(last)))
        local summary = config:get("last_summary")
        if type(summary) == "table" then
            add(string.format(_("Uploaded:  %s sessions, %s books, %s highlights"),
                thousands(summary.sessions), thousands(summary.books), thousands(summary.highlights)))
            add(string.format(_("Took:  %d s in %d request(s)"), summary.duration or 0, summary.chunks or 0))
            add(string.format("%s  %s", _("Trigger:"), TRIGGER_LABEL[summary.trigger] or tostring(summary.trigger or "?")))
        end
    else
        add(_("Never synced."))
    end
    local attempt = config:get("last_attempt")
    if attempt and attempt > 0 and attempt ~= last then
        add(string.format("%s  %s", _("Last attempt:"), UI.relativeTime(attempt)))
    end
    add("")

    add(_("QUEUE"))
    local pending = Stats.countPending(config:get("stat_watermark"))
    add(string.format(_("Waiting to upload:  %s sessions"), pending and thousands(pending) or "?"))
    add(string.format(_("Uploaded in total:  %s sessions"), thousands(config:get("total_sessions_sent"))))
    local watermark = config:get("stat_watermark")
    add(string.format("%s  %s", _("Synced up to:"), watermark > 0 and absoluteTime(watermark) or _("start")))
    add("")

    add(_("LAST ERROR"))
    local error_stamp, error_message = parseError(config:get("last_error"))
    if error_message then
        add(string.format("%s (%s)", error_message, UI.relativeTime(error_stamp)))
    else
        add(_("None"))
    end
    return table.concat(lines, "\n")
end

function UI.showStatus(config)
    UIManager:show(TextViewer:new {
        title = _("Kolibri status"),
        text = UI.statusText(config),
        justified = false,
    })
end

local function refresh(touchmenu_instance)
    if touchmenu_instance and touchmenu_instance.updateItems then
        pcall(function() touchmenu_instance:updateItems() end)
    end
end

local function editText(opts)
    local dialog
    dialog = InputDialog:new {
        title = opts.title,
        input = opts.value or "",
        input_hint = opts.hint,
        text_type = opts.password and "password" or nil,
        buttons = { {
            {
                text = _("Cancel"),
                id = "close",
                callback = function() UIManager:close(dialog) end,
            },
            {
                text = _("Save"),
                is_enter_default = true,
                callback = function()
                    local value = (dialog:getInputText() or ""):match("^%s*(.-)%s*$")
                    UIManager:close(dialog)
                    opts.on_save(value)
                end,
            },
        } },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function UI.testConnection(config)
    local progress = InfoMessage:new { text = _("Testing connection…") }
    UIManager:show(progress)
    UIManager:forceRePaint()
    UIManager:nextTick(function()
        local ok, message = Sync.testConnection(config)
        UIManager:close(progress)
        UIManager:show(InfoMessage:new {
            text = ok and _("Connected. Server reachable and password accepted.")
                or (_("Connection failed:") .. "\n" .. tostring(message)),
        })
    end)
end

local function toggleItem(config, key, label, extra)
    local item = {
        text = label,
        keep_menu_open = true,
        checked_func = function() return config:get(key) end,
        callback = function(touchmenu_instance)
            config:toggle(key)
            refresh(touchmenu_instance)
        end,
    }
    for name, value in pairs(extra or {}) do item[name] = value end
    return item
end

local function radioItems(config, key, values, format)
    local items = {}
    for _i, value in ipairs(values) do
        items[#items + 1] = {
            text = string.format(format, value),
            checked_func = function() return config:get(key) == value end,
            callback = function()
                config:set(key, value)
                config:flush()
            end,
        }
    end
    return items
end

function UI.buildMenu(plugin)
    local config = plugin.config
    local auto_enabled = function() return config:get("auto_sync") end

    return {
        {
            text_func = function() return _("Status: ") .. UI.statusLine(config) end,
            keep_menu_open = true,
            callback = function() UI.showStatus(config) end,
        },
        {
            text = _("Sync now"),
            callback = function() Sync.request(plugin.ui, config, "manual") end,
            separator = true,
        },
        toggleItem(config, "auto_sync", _("Auto sync when network is connected")),
        {
            text = _("Auto sync options"),
            enabled_func = auto_enabled,
            sub_item_table = {
                toggleItem(config, "sync_on_connect", _("When the network connects")),
                toggleItem(config, "sync_on_open", _("When a book opens")),
                toggleItem(config, "sync_while_reading", _("While reading (periodic)")),
                toggleItem(config, "sync_on_close", _("When a book closes")),
                {
                    text_func = function()
                        return string.format(_("Minimum interval: %d min"), config:get("interval_minutes"))
                    end,
                    keep_menu_open = true,
                    sub_item_table = radioItems(config, "interval_minutes", INTERVALS, _("%d minutes")),
                    separator = true,
                },
                toggleItem(config, "notify_auto", _("Show a message after auto sync")),
            },
            separator = true,
        },
        {
            text = _("Server"),
            sub_item_table = {
                {
                    text_func = function()
                        local url = config:get("server_url")
                        return _("URL: ") .. (url ~= "" and url or _("not set"))
                    end,
                    keep_menu_open = true,
                    callback = function(touchmenu_instance)
                        editText {
                            title = _("Kolibri server URL"),
                            value = config:get("server_url"),
                            hint = "http://192.168.1.10:5173",
                            on_save = function(value)
                                config:set("server_url", Client.normalizeUrl(value))
                                config:flush()
                                refresh(touchmenu_instance)
                            end,
                        }
                    end,
                },
                {
                    text_func = function()
                        return _("Password: ") .. (config:get("password") ~= "" and "••••••••" or _("not set"))
                    end,
                    keep_menu_open = true,
                    callback = function(touchmenu_instance)
                        editText {
                            title = _("Kolibri admin password"),
                            value = config:get("password"),
                            hint = _("Same password as the Kolibri dashboard"),
                            password = true,
                            on_save = function(value)
                                config:set("password", value)
                                config:flush()
                                refresh(touchmenu_instance)
                            end,
                        }
                    end,
                },
                {
                    text = _("Test connection"),
                    keep_menu_open = true,
                    callback = function() UI.testConnection(config) end,
                },
            },
        },
        {
            text = _("Advanced"),
            sub_item_table = {
                {
                    text = _("Full resync (re-upload all history)"),
                    keep_menu_open = true,
                    callback = function()
                        UIManager:show(ConfirmBox:new {
                            text = _("Re-upload the whole reading history? This can take a while on large libraries."),
                            ok_text = _("Resync"),
                            ok_callback = function()
                                config:resetSyncState()
                                Sync.request(plugin.ui, config, "manual")
                            end,
                        })
                    end,
                },
                {
                    text = _("Clear last error"),
                    keep_menu_open = true,
                    callback = function(touchmenu_instance)
                        config:set("last_error", "")
                        config:flush()
                        refresh(touchmenu_instance)
                    end,
                    separator = true,
                },
                {
                    text = _("Sessions per request"),
                    sub_item_table = radioItems(config, "batch_size", BATCH_SIZES, _("%d sessions")),
                },
            },
        },
    }
end

return UI
