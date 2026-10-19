-- Persistent plugin settings, stored in <settings dir>/kolibri.lua
local DataStorage = require("datastorage")
local LuaSettings = require("luasettings")

local Config = {}
Config.__index = Config

local DEFAULTS = {
    server_url = "",
    password = "",
    auto_sync = true,          -- master switch for every automatic trigger
    sync_on_connect = true,    -- when Wi-Fi/network comes up
    sync_on_open = true,       -- when a book finishes loading
    sync_on_close = true,      -- when a book is closed / device suspends
    sync_while_reading = true, -- periodic, driven by page turns
    notify_auto = false,       -- toast after automatic syncs
    interval_minutes = 10,     -- minimum gap between automatic syncs
    batch_size = 1500,         -- reading sessions per HTTP request
    -- sync state
    stat_watermark = 0,        -- newest page_stat_data.start_time already uploaded
    last_success = 0,
    last_attempt = 0,
    last_error = "",
    last_summary = nil,        -- { sessions=, books=, highlights=, duration= }
    total_sessions_sent = 0,
}

function Config:new()
    local path = DataStorage:getSettingsDir() .. "/kolibri.lua"
    local o = setmetatable({ store = LuaSettings:open(path) }, self)
    o:migrateLegacy()
    return o
end

function Config:get(key)
    local value = self.store:readSetting(key)
    if value == nil then return DEFAULTS[key] end
    return value
end

function Config:set(key, value)
    self.store:saveSetting(key, value)
end

function Config:toggle(key)
    local new_value = not self:get(key)
    self:set(key, new_value)
    self:flush()
    return new_value
end

function Config:flush()
    self.store:flush()
end

-- Settings written by the first version of the plugin lived in settings.reader.lua.
function Config:migrateLegacy()
    if self.store:readSetting("migrated") then return end
    if G_reader_settings then
        local url = G_reader_settings:readSetting("kolibri_server_url")
        local password = G_reader_settings:readSetting("kolibri_password")
        if url and url ~= "" and (self.store:readSetting("server_url") or "") == "" then
            self.store:saveSetting("server_url", url)
        end
        if password and password ~= "" and (self.store:readSetting("password") or "") == "" then
            self.store:saveSetting("password", password)
        end
    end
    self.store:saveSetting("migrated", true)
    self.store:flush()
end

function Config:isConfigured()
    return self:get("server_url") ~= "" and self:get("password") ~= ""
end

function Config:resetSyncState()
    self:set("stat_watermark", 0)
    self:set("last_error", "")
    self:flush()
end

return Config
