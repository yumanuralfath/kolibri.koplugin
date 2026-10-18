local InputDialog = require("ui/widget/inputdialog")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local _ = require("gettext")

local Kolibri = WidgetContainer:extend {
    name = "kolibri",
    fullname = _("Kolibri reading statistics"),
    description = _("Sync reading progress and highlights to Kolibri."),
}

local SETTINGS = {
    server_url = {
        key = "kolibri_server_url",
        title = _("Kolibri server URL"),
        hint = "http://192.168.1.10:5173",
    },
    sync_token = {
        key = "kolibri_sync_token",
        title = _("Kolibri sync token"),
        hint = _("Paste the KOLIBRI_SYNC_TOKEN value"),
    },
}

local function asString(value)
    if value == nil then
        return ""
    end
    return tostring(value)
end

local function getAuthors(props)
    local authors = props.authors or props.author or {}
    if type(authors) == "string" then
        local result = {}
        for author in authors:gmatch("[^,;]+") do
            local cleaned = author:match("^%s*(.-)%s*$")
            if cleaned ~= "" then
                table.insert(result, cleaned)
            end
        end
        return result
    end
    if type(authors) == "table" then
        local result = {}
        for _, author in ipairs(authors) do
            table.insert(result, asString(author))
        end
        return result
    end
    return {}
end

function Kolibri:init()
    self.server_url = G_reader_settings:readSetting("kolibri_server_url") or ""
    self.sync_token = G_reader_settings:readSetting("kolibri_sync_token") or ""
    self.last_sync = 0
    if self.ui and self.ui.menu then
        self.ui.menu:registerToMainMenu(self)
    end
end

function Kolibri:editSetting(key, title, hint)
    local dialog
    dialog = InputDialog:new {
        title = title,
        input = G_reader_settings:readSetting(key) or "",
        input_hint = hint,
        buttons = { {
            {
                text = _("Cancel"),
                id = "close",
                callback = function()
                    UIManager:close(dialog)
                end,
            },
            {
                text = _("Save"),
                callback = function()
                    local value = (dialog:getInputText() or ""):match("^%s*(.-)%s*$")
                    G_reader_settings:saveSetting(key, value)
                    if key == SETTINGS.server_url.key then
                        self.server_url = value
                    elseif key == SETTINGS.sync_token.key then
                        self.sync_token = value
                    end
                    UIManager:close(dialog)
                    UIManager:show(InfoMessage:new { text = _(title .. " saved.") })
                end,
            },
        } },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function Kolibri:editSettingByName(setting_name)
    local setting = SETTINGS[setting_name]
    if setting then
        self:editSetting(setting.key, setting.title, setting.hint)
    end
end

function Kolibri:addToMainMenu(menu_items)
    menu_items.kolibri = {
        text = _("Kolibri reading stats"),
        sorting_hint = "tools",
        sub_item_table = {
            {
                text = _("Sync current book now"),
                callback = function() self:syncBook(true) end,
            },
            {
                text = _("Set Kolibri server URL"),
                keep_menu_open = true,
                callback = function() self:editSettingByName("server_url") end,
            },
            {
                text = _("Set sync token"),
                keep_menu_open = true,
                callback = function() self:editSettingByName("sync_token") end,
            },
        },
    }
end

function Kolibri:getHighlights()
    local doc_settings = self.ui and self.ui.doc_settings
    local entries = doc_settings and doc_settings:readSetting("annotations")
    if type(entries) ~= "table" then
        local annotation = self.ui and self.ui.annotation
        entries = annotation and annotation.annotations or {}
    end
    local highlights = {}
    for _, item in ipairs(entries) do
        local text = item.text or item.chapter or ""
        if text ~= "" then
            table.insert(highlights, {
                text = text,
                note = item.note,
                page = tonumber(item.page or item.pageno),
                createdAt = item.datetime,
            })
        end
    end
    return highlights
end

function Kolibri:syncBook(force)
    if not self.ui or not self.ui.document then
        return
    end
    if self.server_url == "" or self.sync_token == "" then
        if force then
            UIManager:show(InfoMessage:new { text = _("Set the Kolibri server URL and sync token first.") })
        end
        return
    end

    local document = self.ui.document
    local props = document:getProps() or {}
    local filename = asString(props.file or document.file)
    local title = asString(props.title)
    if title == "" then
        title = filename:match("([^/]+)$") or _("Untitled book")
    end
    local total_pages = tonumber(document:getPageCount()) or 0
    local current_page = tonumber(document:getCurrentPage()) or 0
    local book_id = asString(props.md5 or props.partial_md5 or filename)
    book_id = book_id:gsub("[^%w_%-]", "_")

    local rapidjson = require("rapidjson")
    local payload = rapidjson.encode({
        book = {
            id = book_id,
            title = title,
            authors = getAuthors(props),
            series = props.series,
            language = props.language,
            currentPage = current_page,
            totalPages = total_pages,
        },
        highlights = self:getHighlights(),
    })

    local endpoint = self.server_url:gsub("/+$", "") .. "/api/sync"
    local ltn12 = require("ltn12")
    local response_body = {}
    local request = {
        url = endpoint,
        method = "POST",
        headers = {
            ["Content-Type"] = "application/json",
            ["Content-Length"] = tostring(#payload),
            ["Authorization"] = "Bearer " .. self.sync_token,
        },
        source = ltn12.source.string(payload),
        sink = ltn12.sink.table(response_body),
    }

    local http
    if endpoint:match("^https://") then
        http = require("ssl.https")
    else
        http = require("socket.http")
    end
    http.TIMEOUT = 8
    local _, code, response_headers = http.request(request)
    if tonumber(code) and tonumber(code) >= 200 and tonumber(code) < 300 then
        self.last_sync = os.time()
        if force then
            UIManager:show(InfoMessage:new { text = _("Kolibri sync complete.") })
        end
    elseif force then
        local detail = response_headers and tostring(code) or _("network unavailable")
        UIManager:show(InfoMessage:new { text = _("Kolibri sync failed: ") .. detail })
    end
end

function Kolibri:onReaderReady()
    if self.ui and self.ui.registerEventListener then
        self.ui:registerEventListener("PageUpdate", self)
    end
    self:syncBook(false)
end

function Kolibri:onPageUpdate()
    if os.time() - self.last_sync >= 300 then
        self:syncBook(false)
    end
end

return Kolibri
