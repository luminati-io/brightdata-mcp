#!/usr/bin/env node
'use strict'; /*jslint node:true es9:true*/
import {FastMCP} from 'fastmcp';
import {z} from 'zod';
import axios from 'axios';
import {tools as browser_tools} from './browser_tools.js';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const package_json = require('./package.json');
const api_token = process.env.API_TOKEN;
const unlocker_zone = process.env.WEB_UNLOCKER_ZONE || 'mcp_unlocker';
const dataset_scrape_url = process.env.DATASET_SCRAPE_URL || 'https://api.brightdata.com/datasets/v3/scrape';
const dataset_api_token = process.env.DATASET_API_TOKEN || api_token;

if (!api_token)
    throw new Error('Cannot run MCP server without API_TOKEN env');

const api_headers = ()=>({
    'user-agent': `${package_json.name}/${package_json.version}`,
    authorization: `Bearer ${api_token}`
});

const dataset_api_headers = ()=>({
    'user-agent': `${package_json.name}/${package_json.version}`,
    authorization: `Bearer ${dataset_api_token}`
});

let server = new FastMCP({
    name: 'Bright Data',
    version: package_json.version,
});
let debug_stats = {tool_calls: {}};

server.addTool({
    name: 'search_engine',
    description: 'Scrape search results from Google, Bing or Yandex. Returns '
    +'SERP results in markdown (URL, title, description)',
    parameters: z.object({
        query: z.string(),
        engine: z.enum([
            'google',
            'bing',
            'yandex',
        ]).optional().default('google'),
    }),
    execute: tool_fn('search_engine', async({query, engine})=>{
        let response = await axios({
            url: 'https://api.brightdata.com/request',
            method: 'POST',
            data: {
                url: search_url(engine, query),
                zone: unlocker_zone,
                format: 'raw',
                data_format: 'markdown',
            },
            headers: api_headers(),
            responseType: 'text',
        });
        return response.data;
    }),
});

server.addTool({
    name: 'scrape_as_markdown',
    description: 'Scrape a single webpage URL with advanced options for '
    +'content extraction and get back the results in MarkDown language. '
    +'This tool can unlock any webpage even if it uses bot detection or '
    +'CAPTCHA.',
    parameters: z.object({url: z.string().url()}),
    execute: tool_fn('scrape_as_markdown', async({url})=>{
        let response = await axios({
            url: 'https://api.brightdata.com/request',
            method: 'POST',
            data: {
                url,
                zone: unlocker_zone,
                format: 'raw',
                data_format: 'markdown',
            },
            headers: api_headers(),
            responseType: 'text',
        });
        return response.data;
    }),
});
server.addTool({
    name: 'scrape_as_html',
    description: 'Scrape a single webpage URL with advanced options for '
    +'content extraction and get back the results in HTML. '
    +'This tool can unlock any webpage even if it uses bot detection or '
    +'CAPTCHA.',
    parameters: z.object({url: z.string().url()}),
    execute: tool_fn('scrape_as_html', async({url})=>{
        let response = await axios({
            url: 'https://api.brightdata.com/request',
            method: 'POST',
            data: {
                url,
                zone: unlocker_zone,
                format: 'raw',
            },
            headers: api_headers(),
            responseType: 'text',
        });
        return response.data;
    }),
});

server.addTool({
    name: 'session_stats',
    description: 'Tell the user about the tool usage during this session',
    parameters: z.object({}),
    execute: tool_fn('session_stats', async()=>{
        let used_tools = Object.entries(debug_stats.tool_calls);
        let lines = ['Tool calls this session:'];
        for (let [name, calls] of used_tools)
            lines.push(`- ${name} tool: called ${calls} times`);
        return lines.join('\n');
    }),
});

const datasets = [{
    id: 'amazon_product',
    dataset_id: 'gd_l7q7dkf244hwjntr0',
    description: [
        'Quickly read structured amazon product data.',
        'Requires a valid product URL with /dp/ in it.',
        'This can be a cache lookup, so it can be more reliable than scraping'
    ].join('\n'),
    inputs: ['url'],
}, {
    id: 'amazon_product_reviews',
    dataset_id: 'gd_le8e811kzy4ggddlq',
    description: [
        'Quickly read structured amazon product review data.',
        'Requires a valid product URL with /dp/ in it.',
        'This can be a cache lookup, so it can be more reliable than scraping'
    ].join('\n'),
    inputs: ['url'],
}, {
    id: 'linkedin_person_profile',
    dataset_id: 'gd_l1viktl72bvl7bjuj0',
    description: [
        'Quickly read structured linkedin people profile data.',
        'This can be a cache lookup, so it can be more reliable than scraping'
    ].join('\n'),
    inputs: ['url'],
}, {
    id: 'linkedin_company_profile',
    dataset_id: 'gd_l1vikfnt1wgvvqz95w',
    description: [
        'Quickly read structured linkedin company profile data',
        'This can be a cache lookup, so it can be more reliable than scraping'
    ].join('\n'),
    inputs: ['url'],
}];
for (let {dataset_id, id, description, inputs} of datasets)
{
    let parameters = {};
    for (let input of inputs)
        parameters[input] = input=='url' ? z.string().url() : z.string();
    server.addTool({
        name: `web_data_${id}`,
        description,
        parameters: z.object(parameters),
        execute: tool_fn(`web_data_${id}`, async(data)=>{
            let response = await axios({
                url: dataset_scrape_url,
                params: {dataset_id},
                method: 'POST',
                data: [data],
                headers: dataset_api_headers(),
                responseType: 'text',
            });
            if (!response.data?.length)
                throw new Error('No data found');
            console.error('[%s] %s %s', `web_data_${id}`, response.status,
                response.statusText);
            return response.data;
        }),
    });
}

for (let tool of browser_tools)
    server.addTool(tool);

console.error('Starting server...');
server.start({transportType: 'stdio'});
function tool_fn(name, fn){
    return async data=>{
        debug_stats.tool_calls[name] = debug_stats.tool_calls[name]||0;
        debug_stats.tool_calls[name]++;
        let ts = Date.now();
        console.error(`[%s] executing %s`, name, JSON.stringify(data));
        try { return await fn(data); }
        catch(e){
            if (e.response)
            {
                console.error(`[%s] error %s %s: %s`, name, e.response.status,
                    e.response.statusText, e.response.data);
                let message = e.response.data;
                if (message?.length)
                    throw new Error(`HTTP ${e.response.status}: ${message}`);
            }
            else
                console.error(`[%s] error %s`, name, e.stack);
            throw e;
        } finally {
            let dur = Date.now()-ts;
            console.error(`[%s] tool finished in %sms`, name, dur);
        }
    };
}

function search_url(engine, query){
    let q = encodeURIComponent(query);
    if (engine=='yandex')
        return `https://yandex.com/search/?text=${q}`;
    if (engine=='bing')
        return `https://www.bing.com/search?q=${q}`;
    return `https://www.google.com/search?q=${q}`;
}