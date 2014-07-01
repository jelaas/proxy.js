#!/bin/sysjs

"use strict";

/*
 * File: proxy.js
 * Implements: simple sender-listener proxy function.
 *
 * Copyright: Jens Låås, 2014
 * Copyright license: According to GPL, see file COPYING in this directory.
 *
 */

// 001XNNNNNNN\n
// version S|L NAME
var Sys=Sys1;

var sockets = [];

function event_connecting(cfg)
{
    var res = Sys.read(this.fd, 1024);
    if(res.rc > 0)
	Sys.dprint(1, "Read "+res.buffer.length+" "+res.buffer);
    this.event  = event_listener;
    this.action = action_listener;
    this.name = 'public';
    if(res.rc >= 3) {
	this.proto = String.fromCharCode(res.buffer[0],
					 res.buffer[1],
					 res.buffer[2]);
	if(this.proto == '001') {
	    if(res.rc >= 12) {
		if(String.fromCharCode(res.buffer[3]) == 'S') {
		    this.event = event_sender;
		    this.action = undefined;
		}
		this.name = String.fromCharCode(res.buffer[4],
						res.buffer[5],
						res.buffer[6],
						res.buffer[7],
						res.buffer[8],
						res.buffer[9],
						res.buffer[10]);
		return;
	    }
	    
	    // protocol error
	    Sys.close(this.fd);
	    this.fd = -1;
	} else {
	    this.proto = '000';
	}
    }
}

function event_accept(cfg)
{
    var res = Sys.accept(this.fd);
    if(res.rc >= 0) {
	sockets.push( { fd: res.rc, event: event_connecting, events: Sys.POLLIN, ip: res.addr });
    }
}


function event_sender(cfg)
{
    var res = Sys.read(this.fd, 1024);
    if(res.rc < 1) {
	Sys.close(this.fd);
	this.fd = -1;
	return;
    }
    if(cfg.verbose) Sys.dprint(1, "Sender sent: "+res.buffer);
    if(cfg.logfile) {
	Sys.dprint(cfg.logfile, 'DOMAIN='+this.name+' SRC=' + this.ip + ' ' + res.buffer);
    }
    for(var i=0;i<sockets.length;i++) {
	if(sockets[i].action) {
	    sockets[i].action(this.name, 'DOMAIN='+this.name+' SRC=' + this.ip + ' ' + res.buffer);
	}
    }
}

function event_listener(cfg)
{
    if(cfg.verbose) Sys.dprint(1, "Closing "+this.fd+"\n");
    Sys.close(this.fd);
    this.fd = -1;
}

function action_listener(name, buf)
{
    if(this.name == name)
	Sys.write(this.fd, buf, buf.length);
}

function server(addr, port)
{
    var fd = Sys.socket(Sys.AF_INET, Sys.SOCK_STREAM, Sys.IPPROTO_TCP);
    Sys.setsockopt(fd, Sys.SOL_SOCKET, Sys.SO_REUSEADDR, 1);
    Sys.bind(fd, { in: addr, port: port });
    Sys.listen(fd, 10);
    sockets.push({ fd: fd, event: event_accept, events: Sys.POLLIN });
}


function daemonize()
{
    var pid = Sys.fork();
    if(pid > 0) {
	Sys._exit(0);
    }

    Sys.setsid();
    Sys.chdir("/");
    var fd = Sys.open("/dev/null",Sys.O_RDWR, 0);
    if(fd != -1) {
	Sys.dup2(fd, 0);
	Sys.dup2(fd, 1);
	Sys.dup2(fd, 2);
	if(fd > 2) Sys.close(fd);
    }
}

function main()
{
    var cfg = { addr: '0.0.0.0', port: 1234, daemonize: 0, verbose: 0, logfile: 0 };
    var i=0;
    
    while(i < arguments.length) {
	if(arguments[i] == '-h') {
	    Sys.dprint(1, "proxy.js [-adhvpf]\n" +
		       " -a     listen addr\n" +
		       " -d     daemonize\n" +
		       " -v     verbose\n" +
		       " -p     port [1234]\n" +
		       " -f     filename\n"
		      );
	    Sys.exit(0);
	}
	if(arguments[i] == '-d') {
	    cfg.daemonize = 1;
	    i++;
	    continue;
	}
	if(arguments[i] == '-v') {
	    cfg.verbose++;
	    i++;
	    continue;
	}
	if(arguments[i] == '-f') {
	    cfg.logfile = Sys.open(arguments[i+1], Sys.O_RDWR|Sys.O_APPEND|Sys.O_CREAT, parseInt("0644", 8));
	    if(cfg.logfile == -1) {
		Sys.dprint(1, 'Failed to open logfile '+arguments[i+1]+'\n');
		Sys.exit(1);
	    }
	    i+=2;
	    continue;
	}
	if(arguments[i] == '-p') {
	    cfg.port = parseInt(arguments[i+1], 10);
	    i+=2;
	    continue;
	}
	if(arguments[i] == '-a') {
	    cfg.addr = arguments[i+1];
	    i+=2;
	    continue;
	}
	i++;
    }
    
    if(cfg.daemonize) daemonize();
    
    server(cfg.addr, cfg.port);
    
    while(1) {
	var ret = Sys.poll( sockets, sockets.length, 5000);
	if(cfg.verbose) Sys.dprint(1, "Poll: "+JSON.stringify(ret)+"\n");
	if(ret && ret.rc) {
	    var length = ret.fds.length;
	    for(i=0;i<length;i++) {
		if(cfg.verbose) Sys.dprint(1, "Looking at socket "+sockets[i].fd+"\n");
		if(sockets[i].revents == 0)
		    continue;
		if(cfg.verbose) Sys.dprint(1, "Invoking event on "+sockets[i].fd+"\n");
		sockets[i].event(cfg);
	    }
	    
	    // remove closed sockets
	    while(1) {
		var removed = 0;
		for(i=0;i<sockets.length;i++) {
		    if(sockets[i].fd == -1) {
			if(cfg.verbose) Sys.dprint(1, "Removing socket "+sockets[i].fd+"\n");
			sockets.splice(i, 1);
			removed=1;
			break;
		    }
		}
		if(!removed) break;
	    }
	}
    }
}
