-- HTTP client for the Kolibri /api/sync endpoint.
local ltn12 = require("ltn12")

local Client = {}

-- "192.168.1.10:5173" -> "http://192.168.1.10:5173"; strips trailing slashes.
function Client.normalizeUrl(url)
    url = (url or ""):match("^%s*(.-)%s*$")
    if url == "" then return "" end
    if not url:match("^%a[%w+.-]*://") then
        url = "http://" .. url
    end
    return (url:gsub("/+$", ""))
end

local function decodeJson(body)
    local ok, rapidjson = pcall(require, "rapidjson")
    if not ok then return nil end
    local decoded_ok, decoded = pcall(rapidjson.decode, body)
    if decoded_ok and type(decoded) == "table" then return decoded end
    return nil
end

-- Turns a transport/HTTP failure into a message a human can act on.
local function explain(code, body, url)
    local numeric = tonumber(code)
    if not numeric then
        local text = tostring(code or "unknown error")
        if text:find("timeout", 1, true) then
            return "Timed out. Is the server reachable from this network?", "timeout"
        elseif text:find("refused", 1, true) then
            return "Connection refused. Check the address and port.", "refused"
        elseif text:find("host", 1, true) or text:find("resolve", 1, true) then
            return "Server address not found.", "dns"
        end
        return text, "network"
    end
    local decoded = decodeJson(body)
    local server_message = decoded and decoded.error
    if numeric == 401 then
        return "Wrong password (HTTP 401).", "auth"
    elseif numeric == 413 then
        return "Request too large (HTTP 413). Lower the batch size or raise BODY_SIZE_LIMIT on the server.", "too_large"
    elseif numeric == 301 or numeric == 302 or numeric == 307 or numeric == 308 then
        return "Server redirected the request. Use the final https:// address.", "redirect"
    elseif numeric >= 500 then
        return string.format("Server error (HTTP %d)%s", numeric, server_message and (": " .. server_message) or "."), "server"
    end
    return string.format("HTTP %d%s", numeric, server_message and (": " .. server_message) or ""), "http"
end

--- POST/GET a JSON document.
-- @return ok(boolean), result table|nil, error message|nil, error kind|nil
function Client.request(opts)
    local base = Client.normalizeUrl(opts.server_url)
    if base == "" then return false, nil, "Server URL is empty.", "config" end
    local url = base .. opts.path
    local payload = opts.payload
    local response_body = {}
    local headers = { ["Accept"] = "application/json" }
    if opts.password and opts.password ~= "" then
        headers["Authorization"] = "Bearer " .. opts.password
    end
    local request = {
        url = url,
        method = opts.method or (payload and "POST" or "GET"),
        headers = headers,
        sink = ltn12.sink.table(response_body),
    }
    if payload then
        headers["Content-Type"] = "application/json"
        headers["Content-Length"] = tostring(#payload)
        request.source = ltn12.source.string(payload)
    end

    local http = url:match("^https://") and require("ssl.https") or require("socket.http")
    local socketutil_ok, socketutil = pcall(require, "socketutil")
    if socketutil_ok and socketutil.set_timeout then
        socketutil:set_timeout(opts.block_timeout or 10, opts.total_timeout or 30)
    else
        http.TIMEOUT = opts.block_timeout or 10
    end
    local ok, ret, code = pcall(http.request, request)
    if socketutil_ok and socketutil.reset_timeout then socketutil:reset_timeout() end

    if not ok then return false, nil, tostring(ret), "network" end
    local body = table.concat(response_body)
    -- luasocket returns (nil, err) on transport failure and (1, code) otherwise.
    if ret == nil then
        local message, kind = explain(code, body, url)
        return false, nil, message, kind
    end
    local numeric = tonumber(code)
    if numeric and numeric >= 200 and numeric < 300 then
        return true, decodeJson(body) or {}, nil, nil
    end
    local message, kind = explain(code, body, url)
    return false, nil, message, kind
end

--- Checks reachability and credentials without writing any data.
-- The server answers 401 for a bad password and 400 ("book id required")
-- for an authenticated but empty payload.
function Client.test(server_url, password)
    local reachable, _, reach_error, reach_kind = Client.request({
        server_url = server_url, path = "/api/auth", block_timeout = 6, total_timeout = 10,
    })
    if not reachable then return false, reach_error, reach_kind end
    local ok, _, message, kind = Client.request({
        server_url = server_url, password = password, path = "/api/sync",
        payload = "{}", block_timeout = 6, total_timeout = 10,
    })
    if ok then return true end
    if kind == "http" and message and message:find("HTTP 400", 1, true) then
        return true
    end
    return false, message, kind
end

return Client
