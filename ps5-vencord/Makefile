# Vencord PS5 - payload ELF para PS5 liberada (ps5-payload-sdk)
#
#   export PS5_PAYLOAD_SDK=/opt/ps5-payload-sdk
#   make                 -> vencord-ps5.elf
#   make homebrew        -> dist/VencordPS5/ (carpeta lista para /data/homebrew)
#   make test PS5_HOST=192.168.1.50   -> envia el ELF al elfldr (puerto 9021)

PS5_HOST ?= ps5
PS5_PORT ?= 9021

ifdef PS5_PAYLOAD_SDK
    include $(PS5_PAYLOAD_SDK)/toolchain/prospero.mk
else
    $(error PS5_PAYLOAD_SDK is undefined (instala https://github.com/ps5-payload-dev/sdk))
endif

ELF  := vencord-ps5.elf
SRCS := src/main.c src/proxy.c src/vencord.c src/web.c src/upstream_sce.c

# Vencord se mete dentro del ELF para no depender de descargarlo en la consola.
VENCORD_JS  := vencord/Vencord.user.js
VENCORD_URL := https://github.com/Vendicated/Vencord/releases/download/devbuild/Vencord.user.js

CFLAGS := -O2 -Wall -Werror -Isrc -DVC_PS5
CFLAGS += -DVC_EMBED_VENCORD='"$(CURDIR)/$(VENCORD_JS)"'
LDADD  := -lkernel_sys -lSceSystemService -lSceUserService
LDADD  += -lSceNet -lSceSsl -lSceHttp

all: $(ELF)

$(VENCORD_JS):
	mkdir -p vencord
	wget -q -O $@.tmp $(VENCORD_URL) && mv $@.tmp $@

$(ELF): $(SRCS) $(wildcard src/*.h) $(VENCORD_JS)
	$(CC) $(CFLAGS) -o $@ $(SRCS) $(LDADD)

homebrew: $(ELF)
	rm -rf dist/VencordPS5
	mkdir -p dist/VencordPS5/sce_sys
	cp $(ELF) dist/VencordPS5/eboot.elf
	cp homebrew/VencordPS5/homebrew.js dist/VencordPS5/
	cp homebrew/VencordPS5/sce_sys/icon0.png dist/VencordPS5/sce_sys/

test: $(ELF)
	$(PS5_DEPLOY) -h $(PS5_HOST) -p $(PS5_PORT) $(ELF)

clean:
	rm -rf $(ELF) dist vencord

.PHONY: all homebrew test clean
