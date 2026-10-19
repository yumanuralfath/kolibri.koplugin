local InputDialog = require("ui/widget/inputdialog")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local DataStorage = require("datastorage")
local _ = require("gettext")

local Kolibri = WidgetContainer:extend {
    name = "kolibri",
    fullname = _("Kolibri"),
    description = _("Sync reading progress and highlights to Kolibri."),
}

local SETTINGS = {
    server_url = {
        key = "kolibri_server_url",
        title = _("Kolibri server URL"),
        hint = "http://192.168.1.10:5173",
    },
    password = {
        key = "kolibri_password",
        title = _("Kolibri admin password"),
        hint = _("Enter the same password used to sign in to Kolibri"),
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
    self.password = G_reader_settings:readSetting("kolibri_password") or ""
    self.last_sync = 0
    self.last_attempt = 0
    self.sync_pending = false
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
                    elseif key == SETTINGS.password.key then
                        self.password = value
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
                text = _("Set Kolibri password"),
                keep_menu_open = true,
                callback = function() self:editSettingByName("password") end,
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

function Kolibri:getStatisticsSnapshot()
    local ok, result = pcall(function()
        local reader_ok, ReaderUI = pcall(require, "apps/reader/readerui")
        if reader_ok and ReaderUI and ReaderUI.instance then
            local reader = ReaderUI.instance
            if reader.statistics and reader.statistics.is_doc then
                pcall(function() reader.statistics:insertDB() end)
            end
        end

        local SQLite = require("lua-ljsqlite3/init")
        local database_path = DataStorage:getSettingsDir() .. "/statistics.sqlite3"
        local connection = SQLite.open(database_path)

        local book_result, book_count = connection:exec("SELECT * FROM book")
        local books = {}
        local md5_by_id = {}
        for index = 1, book_count do
            local id = tonumber(book_result[1][index])
            local book = {
                id = book_result[10][index],
                title = book_result[2][index],
                authors = book_result[3][index],
                notes = tonumber(book_result[4][index]) or 0,
                last_open = tonumber(book_result[5][index]) or 0,
                highlights = tonumber(book_result[6][index]) or 0,
                pages = tonumber(book_result[7][index]) or 0,
                series = book_result[8][index],
                language = book_result[9][index],
                total_read_time = tonumber(book_result[11][index]) or 0,
                total_read_pages = tonumber(book_result[12][index]) or 0,
            }
            books[#books + 1] = book
            md5_by_id[id] = book.id
        end

        local stats_result, stats_count = connection:exec("SELECT * FROM page_stat_data")
        local stats = {}
        for index = 1, stats_count do
            local book_id = tonumber(stats_result[1][index])
            local book_md5 = md5_by_id[book_id]
            if book_md5 then
                stats[#stats + 1] = {
                    book_md5 = book_md5,
                    page = tonumber(stats_result[2][index]) or 0,
                    start_time = tonumber(stats_result[3][index]) or 0,
                    duration = tonumber(stats_result[4][index]) or 0,
                    total_pages = tonumber(stats_result[5][index]) or 0,
                }
            end
        end
        connection:close()
        return { books = books, stats = stats }
    end)

    if ok then return result end
    return { books = {}, stats = {} }
end

function Kolibri:getBookPayload()
    if not self.ui or not self.ui.document then
        return nil
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
    local snapshot = self:getStatisticsSnapshot()
    local sidecar_md5
    if self.ui and self.ui.doc_settings then
        sidecar_md5 = self.ui.doc_settings:readSetting("partial_md5_checksum")
    end
    local book_id = asString(sidecar_md5 or props.md5 or props.partial_md5 or filename)
    for _, book in ipairs(snapshot.books) do
        if book.title == title then
            book_id = book.id
            break
        end
    end
    book_id = book_id:gsub("[^%w_%-]", "_")

    local rapidjson = require("rapidjson")
    return rapidjson.encode({
        book = {
            id = book_id,
            title = title,
            authors = getAuthors(props),
            series = props.series,
            language = props.language,
            currentPage = current_page,
            totalPages = total_pages,
        },
        books = snapshot.books,
        stats = snapshot.stats,
        highlights = self:getHighlights(),
    })
end

function Kolibri:postPayload(payload)
    local endpoint = self.server_url:gsub("/+$", "") .. "/api/sync"
    local ltn12 = require("ltn12")
    local response_body = {}
    local request = {
        url = endpoint,
        method = "POST",
        headers = {
            ["Content-Type"] = "application/json",
            ["Content-Length"] = tostring(#payload),
            ["Authorization"] = "Bearer " .. self.password,
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
    local _, code, response_headers, status = http.request(request)
    if tonumber(code) and tonumber(code) >= 200 and tonumber(code) < 300 then
        self.last_sync = os.time()
        return true
    end
    return false, status or response_headers or code or _("network unavailable")
end

function Kolibri:syncBook(force, network_reconnected)
    if not self.ui or not self.ui.document then return end
    if self.server_url == "" or self.password == "" then
        if force then
            UIManager:show(InfoMessage:new { text = _("Set the Kolibri server URL and admin password first.") })
        end
        return
    end
    if self.sync_pending or (not force and not network_reconnected and os.time() - self.last_attempt < 300) then return end

    local payload = self:getBookPayload()
    if not payload then return end
    self.last_attempt = os.time()
    self.sync_pending = true

    local function sendWhenOnline()
        local ok, sent, detail = pcall(function()
            return self:postPayload(payload)
        end)
        self.sync_pending = false
        if force then
            local message
            if ok and sent then
                message = _("Kolibri sync complete.")
            else
                message = _("Kolibri sync failed: ") .. tostring(ok and detail or sent)
            end
            UIManager:show(InfoMessage:new { text = message })
        end
    end

    local ok, NetworkMgr = pcall(require, "ui/network/manager")
    if ok and NetworkMgr and NetworkMgr.runWhenOnline then
        local scheduled = pcall(function()
            NetworkMgr:runWhenOnline(sendWhenOnline)
        end)
        if not scheduled then
            self.sync_pending = false
            if force then
                UIManager:show(InfoMessage:new { text = _("Could not start the Kolibri network request.") })
            end
        end
    else
        sendWhenOnline()
    end
end

function Kolibri:onReaderReady()
    if self.ui and self.ui.registerEventListener then
        self.ui:registerEventListener("PageUpdate", self)
        self.ui:registerEventListener("NetworkConnected", self)
    end
    self:syncBook(false)
end

function Kolibri:onPageUpdate()
    self:syncBook(false)
end

function Kolibri:onNetworkConnected()
    self:syncBook(false, true)
end

return Kolibri
