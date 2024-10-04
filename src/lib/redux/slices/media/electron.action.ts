import { ElectronService } from 'ngx-electron';
import { pullMediaData } from './thunks';


const isElectronApp = new ElectronService().isElectronApp;
const e = isElectronApp ? window.electron.ipcRenderer : undefined;

export const ElectronConnection = () => {

    if (!isElectronApp) {
        return (dispatch: any) => {

            // dispatch({ type: 'media/transformStringToMedia', payload: example })
            dispatch(pullMediaData(example))
        }
    }


    return (dispatch: any) => {
        if (e)
            e.on('directoryOpen', (e: any, args: any) => {
                console.log("Receive files ", args.length);

                dispatch({ type: 'media/transformStringToMedia', payload: args })
            })
    }
}


export const OpenDirectory = () => {

    if (!isElectronApp) {
        return (dispatch: any) => { }
    }


    return (dispatch: any) => {
        if (e)
            e.send('open', new Date().toISOString());
    }
}

const example = [
    {
        "item": "/mnt/BACKUP/videos2/5v3_cRMAfa_VID_20240813_231906984.mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/5v3_cRMAfa",
        "size": 120990509
    },
    {
        "item": "/mnt/BACKUP/videos2/xx3Kd7_Afa_VID_20230914_194240.mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/xx3Kd7_Afa",
        "size": 103784069
    },
    {
        "item": "/mnt/BACKUP/videos2/KAtMesalku_VID_20231207_221535.mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/KAtMesalku",
        "size": 87618384
    },
    {
        "item": "/mnt/BACKUP/videos2/15kv8_lPku_VID_20230716_220857.mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/15kv8_lPku",
        "size": 42224541
    },
    {
        "item": "/mnt/BACKUP/videos2/D2Ey7W84ge_1712156524533.mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/D2Ey7W84ge",
        "size": 36067777
    },
    {
        "item": "/mnt/BACKUP/videos2/YQDIOqp0jq_VID_20230817_005431.mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/YQDIOqp0jq",
        "size": 31177874
    },
    {
        "item": "/mnt/BACKUP/videos2/V6HGS1ofge_3.MH xvsr. •k l m1 8.. • bk..mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/V6HGS1ofge",
        "size": 28893005
    },
    {
        "item": "/mnt/BACKUP/videos2/bdtx-HSjku_ɑɳɠɛɭɨcfuckɖɵɭɭ (32) [1cO2uTzM-32].mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/bdtx-HSjku",
        "size": 28649059
    },
    {
        "item": "/mnt/BACKUP/videos2/Sf4bpl3Djq_ɑɳɠɛɭɨcfuckɖɵɭɭ (36) [1cO2uTzM-36].mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/Sf4bpl3Djq",
        "size": 22142079
    },
    {
        "item": "/mnt/BACKUP/videos2/qdLJEMVrfa_1.mh ngod. •k l M0 5.. • b gh..mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/qdLJEMVrfa",
        "size": 21134115
    },
    {
        "item": "/mnt/BACKUP/videos2/8ADlJG5Yge_ɑɳɠɛɭɨcfuckɖɵɭɭ (44) [1cO2uTzM-44].mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/8ADlJG5Yge",
        "size": 12858345
    },
    {
        "item": "/mnt/BACKUP/videos2/pUfFPEEuge_ɑɳɠɛɭɨcfuckɖɵɭɭ (26) [1cO2uTzM-26].mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/pUfFPEEuge",
        "size": 6034090
    },
    {
        "item": "/mnt/BACKUP/videos2/v8A_9JwPge_ɑɳɠɛɭɨcfuckɖɵɭɭ (19) [1cO2uTzM-19].mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/v8A_9JwPge",
        "size": 5959824
    },
    {
        "item": "/mnt/BACKUP/videos2/WCGZvLt_ge_ɑɳɠɛɭɨcfuckɖɵɭɭ (22) [1cO2uTzM-22].mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/WCGZvLt_ge",
        "size": 5457920
    },
    {
        "item": "/mnt/BACKUP/videos2/3efYEoJrku_ɑɳɠɛɭɨcfuckɖɵɭɭ (12) [1cO2uTzM-12].mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/3efYEoJrku",
        "size": 5358710
    },
    {
        "item": "/mnt/BACKUP/videos2/knmprCAUge_ɑɳɠɛɭɨcfuckɖɵɭɭ (24) [1cO2uTzM-24].mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/knmprCAUge",
        "size": 5027472
    },
    {
        "item": "/mnt/BACKUP/videos2/FPOlyNjGge_ɑɳɠɛɭɨcfuckɖɵɭɭ (28) [1cO2uTzM-28].mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/FPOlyNjGge",
        "size": 4983448
    },
    {
        "item": "/mnt/BACKUP/videos2/w_rHTbFffa_received_293617519917516.mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/w_rHTbFffa",
        "size": 4759214
    },
    {
        "item": "/mnt/BACKUP/videos2/JRvXOcduku_2.MH xvsr. •k l m0 1.. • bk..mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/JRvXOcduku",
        "size": 4684955
    },
    {
        "item": "/mnt/BACKUP/videos2/fbibo_MDku_ɑɳɠɛɭɨcfuckɖɵɭɭ (15) [1cO2uTzM-15].mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/fbibo_MDku",
        "size": 4194724
    },
    {
        "item": "/mnt/BACKUP/videos2/H6Ir8fljge_ɑɳɠɛɭɨcfuckɖɵɭɭ (13) [1cO2uTzM-13].mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/H6Ir8fljge",
        "size": 4002977
    },
    {
        "item": "/mnt/BACKUP/videos2/avw_ZI2wku_Gtwk2YHT_720p.mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/avw_ZI2wku",
        "size": 3875552
    },
    {
        "item": "/mnt/BACKUP/videos2/l-KmD2zrku_ɑɳɠɛɭɨcfuckɖɵɭɭ (8) [1cO2uTzM-8].mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/l-KmD2zrku",
        "size": 3647850
    },
    {
        "item": "/mnt/BACKUP/videos2/VBAinZwDku_20241002_132858.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/VBAinZwDku",
        "size": 3488195
    },
    {
        "item": "/mnt/BACKUP/videos2/0pp2bnu6ku_ɑɳɠɛɭɨcfuckɖɵɭɭ (34) [1cO2uTzM-34].mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/0pp2bnu6ku",
        "size": 3487721
    },
    {
        "item": "/mnt/BACKUP/videos2/P1lalS2Sge_ɑɳɠɛɭɨcfuckɖɵɭɭ (5) [1cO2uTzM-5].mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/P1lalS2Sge",
        "size": 3487407
    },
    {
        "item": "/mnt/BACKUP/videos2/foUAXuD2fa_ɑɳɠɛɭɨcfuckɖɵɭɭ (1) [1cO2uTzM-1].mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/foUAXuD2fa",
        "size": 3288955
    },
    {
        "item": "/mnt/BACKUP/videos2/1PdyiUmmku_ɑɳɠɛɭɨcfuckɖɵɭɭ (10) [1cO2uTzM-10].mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/1PdyiUmmku",
        "size": 3262667
    },
    {
        "item": "/mnt/BACKUP/videos2/Xgo4iScSku_20241002_132920.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/Xgo4iScSku",
        "size": 3261657
    },
    {
        "item": "/mnt/BACKUP/videos2/lkaVPCq0ge_20241002_132859.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/lkaVPCq0ge",
        "size": 3175478
    },
    {
        "item": "/mnt/BACKUP/videos2/efRCy3lGfa_20241002_132916.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/efRCy3lGfa",
        "size": 3034559
    },
    {
        "item": "/mnt/BACKUP/videos2/HO-94ig4ge_ɑɳɠɛɭɨcfuckɖɵɭɭ (30) [1cO2uTzM-30].mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/HO-94ig4ge",
        "size": 2765480
    },
    {
        "item": "/mnt/BACKUP/videos2/kuwKYYVwku_ɑɳɠɛɭɨcfuckɖɵɭɭ (42) [1cO2uTzM-42].mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/kuwKYYVwku",
        "size": 2583838
    },
    {
        "item": "/mnt/BACKUP/videos2/LzDdKGhZfa_.XPlayer_1725194237949.mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/LzDdKGhZfa",
        "size": 2559952
    },
    {
        "item": "/mnt/BACKUP/videos2/zRGxxL8_jq_1685364818638.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/zRGxxL8_jq",
        "size": 2236857
    },
    {
        "item": "/mnt/BACKUP/videos2/LEnrL8AZjq_1694740463447.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/LEnrL8AZjq",
        "size": 2181146
    },
    {
        "item": "/mnt/BACKUP/videos2/QgJA_v9jjq_1700701236799.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/QgJA_v9jjq",
        "size": 2008312
    },
    {
        "item": "/mnt/BACKUP/videos2/gRku3V7Nku_1692108203055.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/gRku3V7Nku",
        "size": 1998810
    },
    {
        "item": "/mnt/BACKUP/videos2/y8e7DEvrfa_1694740526161.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/y8e7DEvrfa",
        "size": 1943249
    },
    {
        "item": "/mnt/BACKUP/videos2/x6DjRa50ge_1694740463481.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/x6DjRa50ge",
        "size": 1736553
    },
    {
        "item": "/mnt/BACKUP/videos2/CQEp4Gk4jq_1699757450459.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/CQEp4Gk4jq",
        "size": 1725995
    },
    {
        "item": "/mnt/BACKUP/videos2/7N7JgOVRjq_VID-20231112-WA0011.mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/7N7JgOVRjq",
        "size": 1623297
    },
    {
        "item": "/mnt/BACKUP/videos2/1ZoS6SH4ku_1694740463465.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/1ZoS6SH4ku",
        "size": 1580697
    },
    {
        "item": "/mnt/BACKUP/videos2/IsgvY-Rwge_1699757450447.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/IsgvY-Rwge",
        "size": 1537515
    },
    {
        "item": "/mnt/BACKUP/videos2/uUBBjGDSfa_1699758323254.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/uUBBjGDSfa",
        "size": 1415825
    },
    {
        "item": "/mnt/BACKUP/videos2/lS44z7uGku_1691877854839.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/lS44z7uGku",
        "size": 1345806
    },
    {
        "item": "/mnt/BACKUP/videos2/oZUz6eT4fa_1700701236806.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/oZUz6eT4fa",
        "size": 1334907
    },
    {
        "item": "/mnt/BACKUP/videos2/G7PVSNcLfa_1700701236794.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/G7PVSNcLfa",
        "size": 1318998
    },
    {
        "item": "/mnt/BACKUP/videos2/ojFkarj6ge_1699757450382.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/ojFkarj6ge",
        "size": 1291366
    },
    {
        "item": "/mnt/BACKUP/videos2/QTof58x4fa_1692330211762.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/QTof58x4fa",
        "size": 1225598
    },
    {
        "item": "/mnt/BACKUP/videos2/49sq9XAjfa_IMG_7166.MP4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/49sq9XAjfa",
        "size": 867195
    },
    {
        "item": "/mnt/BACKUP/videos2/k5ufCcirjq_1-Видео от echoes of lust.mp4",
        "mime": "video/mp4",
        "fileName": "https://192.168.25.90:9696/k5ufCcirjq",
        "size": 721884
    },
    {
        "item": "/mnt/BACKUP/videos2/HidT_9Xjge_IMG-20170512-WA0005.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/HidT_9Xjge",
        "size": 531096
    },
    {
        "item": "/mnt/BACKUP/videos2/5jbqGTkcfa_1691877770162.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/5jbqGTkcfa",
        "size": 467416
    },
    {
        "item": "/mnt/BACKUP/videos2/bnreHXxcjq_1566660805008.png",
        "mime": "image/png",
        "fileName": "https://192.168.25.90:9696/bnreHXxcjq",
        "size": 357943
    },
    {
        "item": "/mnt/BACKUP/videos2/xec2Vn0fge_SMEq5OzH.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/xec2Vn0fge",
        "size": 330198
    },
    {
        "item": "/mnt/BACKUP/videos2/dXn3QCK0ku_kSbUq9oS.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/dXn3QCK0ku",
        "size": 297003
    },
    {
        "item": "/mnt/BACKUP/videos2/-SWhzPyajq_1648799010211.jpg",
        "mime": "image/jpeg",
        "fileName": "-https://192.168.25.90:9696/SWhzPyajq",
        "size": 296841
    },
    {
        "item": "/mnt/BACKUP/videos2/ASMb5gxyjq_hK2rMAlW.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/ASMb5gxyjq",
        "size": 289386
    },
    {
        "item": "/mnt/BACKUP/videos2/m4-M7yW4jq_1605540860587.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/m4-M7yW4jq",
        "size": 283285
    },
    {
        "item": "/mnt/BACKUP/videos2/a_8RDOrXfa_q4yNES7E.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/a_8RDOrXfa",
        "size": 282722
    },
    {
        "item": "/mnt/BACKUP/videos2/H73QmBbDge_1648799010234.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/H73QmBbDge",
        "size": 282137
    },
    {
        "item": "/mnt/BACKUP/videos2/mkIhVL4fjq_1648799010162.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/mkIhVL4fjq",
        "size": 277414
    },
    {
        "item": "/mnt/BACKUP/videos2/Q-5KT7FLjq_1-KCM3JjPH.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/Q-5KT7FLjq",
        "size": 242385
    },
    {
        "item": "/mnt/BACKUP/videos2/3ORWh0YRfa_AhiyV1p2.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/3ORWh0YRfa",
        "size": 194227
    },
    {
        "item": "/mnt/BACKUP/videos2/l9mkDmzXge_1mXe04xl.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/l9mkDmzXge",
        "size": 189938
    },
    {
        "item": "/mnt/BACKUP/videos2/iX7ckyNSfa_N5mieJ7s.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/iX7ckyNSfa",
        "size": 188266
    },
    {
        "item": "/mnt/BACKUP/videos2/8Oi6ypfGjq_2JrvZ0CQ.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/8Oi6ypfGjq",
        "size": 173699
    },
    {
        "item": "/mnt/BACKUP/videos2/iOG8y1fafa_1648799010189.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/iOG8y1fafa",
        "size": 159893
    },
    {
        "item": "/mnt/BACKUP/videos2/AxBscqRQku_k2kOzh56.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/AxBscqRQku",
        "size": 159502
    },
    {
        "item": "/mnt/BACKUP/videos2/Z7C2CqeXku_YWtrqpyz.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/Z7C2CqeXku",
        "size": 154825
    },
    {
        "item": "/mnt/BACKUP/videos2/blVSa1b6fa_Mv2S3OaF.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/blVSa1b6fa",
        "size": 147373
    },
    {
        "item": "/mnt/BACKUP/videos2/zgytpJ7Dge_9gDNn7G2.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/zgytpJ7Dge",
        "size": 142359
    },
    {
        "item": "/mnt/BACKUP/videos2/HQHfNf4djq_HIWJMeMF.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/HQHfNf4djq",
        "size": 140376
    },
    {
        "item": "/mnt/BACKUP/videos2/oe1WF6Yrjq_5bIlApu1.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/oe1WF6Yrjq",
        "size": 138389
    },
    {
        "item": "/mnt/BACKUP/videos2/Uo0FrQEoge_RFibGGrA.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/Uo0FrQEoge",
        "size": 138344
    },
    {
        "item": "/mnt/BACKUP/videos2/GdZL-jGjfa_atH3yEXO.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/GdZL-jGjfa",
        "size": 138218
    },
    {
        "item": "/mnt/BACKUP/videos2/--VMnvq9jq_pPWn7uBO.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "--https://192.168.25.90:9696/VMnvq9jq",
        "size": 135682
    },
    {
        "item": "/mnt/BACKUP/videos2/t0iZBFZGge_XQx1LrRo.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/t0iZBFZGge",
        "size": 134876
    },
    {
        "item": "/mnt/BACKUP/videos2/lqNVcNIAjq_mGIxDAel.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/lqNVcNIAjq",
        "size": 129964
    },
    {
        "item": "/mnt/BACKUP/videos2/a7xCmZnDjq_cTXcb2TJ.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/a7xCmZnDjq",
        "size": 120455
    },
    {
        "item": "/mnt/BACKUP/videos2/9k-LWia2jq_A9yWlXKe.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/9k-LWia2jq",
        "size": 115969
    },
    {
        "item": "/mnt/BACKUP/videos2/miK0q2doku_IMG-20170817-WA0037.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/miK0q2doku",
        "size": 114151
    },
    {
        "item": "/mnt/BACKUP/videos2/f3BukWRSku_wqUGxOGO.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/f3BukWRSku",
        "size": 113498
    },
    {
        "item": "/mnt/BACKUP/videos2/ZYyDAdUGku_KEdxSs9e.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/ZYyDAdUGku",
        "size": 112717
    },
    {
        "item": "/mnt/BACKUP/videos2/ZyYj0jjhfa_qs1XhDZz.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/ZyYj0jjhfa",
        "size": 111689
    },
    {
        "item": "/mnt/BACKUP/videos2/WioiWSi2ku_wPxtVXot.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/WioiWSi2ku",
        "size": 109744
    },
    {
        "item": "/mnt/BACKUP/videos2/WPn9N81Zge_ZxrFkXAS.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/WPn9N81Zge",
        "size": 109637
    },
    {
        "item": "/mnt/BACKUP/videos2/6_hOnVqDfa_IMG-20170520-WA0045.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/6_hOnVqDfa",
        "size": 109621
    },
    {
        "item": "/mnt/BACKUP/videos2/SLAa2ZMNge_qpx2xHCk.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/SLAa2ZMNge",
        "size": 103833
    },
    {
        "item": "/mnt/BACKUP/videos2/n9Y-9zwjku_1QE6dAgF.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/n9Y-9zwjku",
        "size": 102244
    },
    {
        "item": "/mnt/BACKUP/videos2/Q097RO10jq_yDrgvkXb.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/Q097RO10jq",
        "size": 102043
    },
    {
        "item": "/mnt/BACKUP/videos2/fS7PjirSku_A017PZUE.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/fS7PjirSku",
        "size": 97729
    },
    {
        "item": "/mnt/BACKUP/videos2/DD4uv7BFjq_kgzF2LBK.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/DD4uv7BFjq",
        "size": 97712
    },
    {
        "item": "/mnt/BACKUP/videos2/37p8mTf9ge_IMG-20170903-WA0034.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/37p8mTf9ge",
        "size": 92385
    },
    {
        "item": "/mnt/BACKUP/videos2/tzX2Jz0cjq_IMG-20170614-WA0056.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/tzX2Jz0cjq",
        "size": 86237
    },
    {
        "item": "/mnt/BACKUP/videos2/SVnUPms0fa_K7sXamYZ.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/SVnUPms0fa",
        "size": 85867
    },
    {
        "item": "/mnt/BACKUP/videos2/enJdELLbfa_IMG_20241002_134254_494.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/enJdELLbfa",
        "size": 85696
    },
    {
        "item": "/mnt/BACKUP/videos2/-4ce8Thjjq_VswCiAAF.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "-https://192.168.25.90:9696/4ce8Thjjq",
        "size": 81998
    },
    {
        "item": "/mnt/BACKUP/videos2/TQRwiumSge_IMG-20170627-WA0023.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/TQRwiumSge",
        "size": 77813
    },
    {
        "item": "/mnt/BACKUP/videos2/V403CQerge_FGe1UkAW.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/V403CQerge",
        "size": 77468
    },
    {
        "item": "/mnt/BACKUP/videos2/FhvEFs-rge_IMG-20170504-WA0003.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/FhvEFs-rge",
        "size": 75596
    },
    {
        "item": "/mnt/BACKUP/videos2/QOX8f5t7ge_IMG_20241002_134252_144.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/QOX8f5t7ge",
        "size": 71467
    },
    {
        "item": "/mnt/BACKUP/videos2/OXTiQ0O0fa_IMG-20170529-WA0039.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/OXTiQ0O0fa",
        "size": 70292
    },
    {
        "item": "/mnt/BACKUP/videos2/yP2o4Akyfa_IMG-20170919-WA0002.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/yP2o4Akyfa",
        "size": 66007
    },
    {
        "item": "/mnt/BACKUP/videos2/gFvVLIstge_USAWtPXi.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/gFvVLIstge",
        "size": 65866
    },
    {
        "item": "/mnt/BACKUP/videos2/h8XZTPtfku_IMG-20170919-WA0003.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/h8XZTPtfku",
        "size": 61641
    },
    {
        "item": "/mnt/BACKUP/videos2/Z8FinXy9ku_1681502111670.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/Z8FinXy9ku",
        "size": 58377
    },
    {
        "item": "/mnt/BACKUP/videos2/aK7XKlbJku_IMG_20241002_134250_076.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/aK7XKlbJku",
        "size": 57346
    },
    {
        "item": "/mnt/BACKUP/videos2/Q5SyC0mXjq_8dwlGqU0.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/Q5SyC0mXjq",
        "size": 52452
    },
    {
        "item": "/mnt/BACKUP/videos2/-1Rnle6Sjq_zzv9a9te.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "-https://192.168.25.90:9696/1Rnle6Sjq",
        "size": 52078
    },
    {
        "item": "/mnt/BACKUP/videos2/wbY8U5Lffa_IMG-20170731-WA0040.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/wbY8U5Lffa",
        "size": 51138
    },
    {
        "item": "/mnt/BACKUP/videos2/9TUs5uB4ku_IMG-20230210-WA0057.jpeg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/9TUs5uB4ku",
        "size": 49938
    },
    {
        "item": "/mnt/BACKUP/videos2/CBuztc9oge_NL8OQzc4.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/CBuztc9oge",
        "size": 43174
    },
    {
        "item": "/mnt/BACKUP/videos2/Y04VARIGfa_e1jXuTYt.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/Y04VARIGfa",
        "size": 39746
    },
    {
        "item": "/mnt/BACKUP/videos2/a6_zmjn9fa_IMG-20240106-WA0013.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/a6_zmjn9fa",
        "size": 38368
    },
    {
        "item": "/mnt/BACKUP/videos2/QgOooxQDfa_IWfpznD9.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/QgOooxQDfa",
        "size": 26639
    },
    {
        "item": "/mnt/BACKUP/videos2/tpPXHhtIjq_1485467350149.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/tpPXHhtIjq",
        "size": 26566
    },
    {
        "item": "/mnt/BACKUP/videos2/rVtSjYrmge_Zbz2ukbX.jpeg.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/rVtSjYrmge",
        "size": 25879
    },
    {
        "item": "/mnt/BACKUP/videos2/83OKB3_Gjq_IMG-20231022-WA0006.jpg",
        "mime": "image/jpeg",
        "fileName": "https://192.168.25.90:9696/83OKB3_Gjq",
        "size": 22307
    }
]